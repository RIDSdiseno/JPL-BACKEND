import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../config/prisma/prisma.service';
import { TcpDeviceRegistryService } from '../tcp/registry/tcp-device-registry.service';
import {
  buildAutoBindCardModeCommand,
  buildClearIcCardsCommand,
  buildEnableTrackingCommand,
  buildForceGpsCommand,
  buildSetIcCardPasswordCommand,
  buildSetPasswordCommand,
} from '../tcp/protocols/hhd-protocol';

@Injectable()
export class ControlService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: TcpDeviceRegistryService,
  ) {}

  async getDevices() {
    const devices = await this.prisma.device.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        imei: true,
        serialNumber: true,
        deviceId: true,
        providerId: true,
        onlineStatus: true,
        productModel: true,
        nfcSupported: true,
        remoteUnlockSupported: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return devices.map((d) => {
      const terminalId = this.resolveTerminalId(d);

      return {
        ...d,
        terminalId,
        isOnlineTcp: Boolean(this.registry.getDeviceByTerminalId(terminalId)),
      };
    });
  }

  async getNfcCards(deviceId: string) {
    const device = await this.findDeviceOrFail(deviceId);

    const cards = await this.prisma.deviceNfcCard.findMany({
      where: { deviceId },
      orderBy: { createdAt: 'asc' },
    });

    return { device, cards };
  }

  async addNfcCard(
    deviceId: string,
    data: { cardNumber: string; createdById?: string },
  ) {
    await this.findDeviceOrFail(deviceId);

    const existing = await this.prisma.deviceNfcCard.findFirst({
      where: { deviceId, cardNumber: data.cardNumber },
    });

    if (existing) {
      return {
        created: false,
        card: existing,
        message: 'La tarjeta ya existe en este dispositivo',
      };
    }

    const card = await this.prisma.deviceNfcCard.create({
      data: {
        id: randomUUID(),
        deviceId,
        nfcCardId: randomUUID(),
        cardNumber: data.cardNumber,
        blockNumber: 'AUTO',
        status: 'ACTIVE',
        createdById: data.createdById,
      },
    });

    return {
      created: true,
      card,
      message:
        'Tarjeta NFC registrada en sistema. Para vincularla físicamente, activa el modo auto-vinculación y acerca la tarjeta al candado.',
    };
  }

  async removeNfcCard(deviceId: string, cardId: string) {
    await this.findDeviceOrFail(deviceId);

    const card = await this.prisma.deviceNfcCard.findFirst({
      where: { id: cardId, deviceId },
    });

    if (!card) throw new NotFoundException('Tarjeta NFC no encontrada');

    await this.prisma.deviceNfcCard.delete({ where: { id: cardId } });

    return { deleted: true, message: 'Tarjeta NFC eliminada del sistema' };
  }

  async startNfcAutoBind(
    deviceId: string,
    data?: { seconds?: number; operatorName?: string },
  ) {
    const device = await this.findDeviceOrFail(deviceId);
    const terminalId = this.resolveTerminalId(device);
    const seconds = data?.seconds ?? 60;

    const command = buildAutoBindCardModeCommand(terminalId, seconds);

    return this.sendOrQueue(terminalId, command, 'NFC_AUTO_BIND', deviceId, {
      seconds,
      operatorName: data?.operatorName ?? 'admin',
      instruction:
        'Acerque la tarjeta IC/NFC al candado mientras el modo de vinculación esté activo.',
    });
  }

  async setIcCardPassword(
    deviceId: string,
    data: { password: string; operatorName?: string },
  ) {
    const device = await this.findDeviceOrFail(deviceId);
    const terminalId = this.resolveTerminalId(device);

    if (
      !data.password ||
      data.password.length < 4 ||
      data.password.length > 16
    ) {
      return {
        ok: false,
        message: 'La contraseña IC debe tener entre 4 y 16 caracteres',
      };
    }

    const command = buildSetIcCardPasswordCommand(terminalId, data.password);

    return this.sendOrQueue(
      terminalId,
      command,
      'SET_IC_CARD_PASSWORD',
      deviceId,
      {
        operatorName: data.operatorName ?? 'admin',
      },
    );
  }

  async clearIcCards(deviceId: string, data?: { operatorName?: string }) {
    const device = await this.findDeviceOrFail(deviceId);
    const terminalId = this.resolveTerminalId(device);

    const command = buildClearIcCardsCommand(terminalId);

    await this.prisma.deviceNfcCard
      .updateMany({
        where: { deviceId },
        data: { status: 'CLEARED' },
      })
      .catch(() => {});

    return this.sendOrQueue(terminalId, command, 'CLEAR_IC_CARDS', deviceId, {
      operatorName: data?.operatorName ?? 'admin',
    });
  }

  async setPassword(
    deviceId: string,
    data: { password: string; operatorName?: string },
  ) {
    const device = await this.findDeviceOrFail(deviceId);
    const terminalId = this.resolveTerminalId(device);

    if (!/^\d{4,6}$/.test(data.password)) {
      return {
        ok: false,
        message: 'La contraseña debe tener entre 4 y 6 dígitos numéricos',
      };
    }

    const command = buildSetPasswordCommand(terminalId, data.password);

    await this.prisma.dynamicPasswordAuditLog
      .create({
        data: {
          id: randomUUID(),
          deviceId,
          viewedById: data.operatorName,
          result: 'QUEUED',
        },
      })
      .catch(() => {});

    return this.sendOrQueue(terminalId, command, 'SET_PASSWORD', deviceId, {
      operatorName: data.operatorName ?? 'admin',
    });
  }

  async getCommandLog(params: {
    deviceId?: string;
    limit?: number;
    offset?: number;
    status?: string;
  }) {
    const limit = Math.min(params.limit ?? 50, 200);
    const offset = params.offset ?? 0;

    const where: Record<string, unknown> = {};

    if (params.deviceId) where.deviceId = params.deviceId;
    if (params.status) where.status = params.status;

    const [commands, total] = await Promise.all([
      this.prisma.deviceParameterCommand.findMany({
        where,
        orderBy: { requestedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.deviceParameterCommand.count({ where }),
    ]);

    return { commands, total, limit, offset };
  }

  async getParameterSnapshots(deviceId: string) {
    await this.findDeviceOrFail(deviceId);

    const snapshots = await this.prisma.deviceParameterSnapshot.findMany({
      where: { deviceId },
      orderBy: { readAt: 'desc' },
      take: 20,
    });

    return { snapshots };
  }

  async applyPreset(
    deviceId: string,
    preset: 'tracking_fast' | 'tracking_normal' | 'tracking_slow' | 'gps_force',
    operatorName?: string,
  ) {
    const device = await this.findDeviceOrFail(deviceId);
    const terminalId = this.resolveTerminalId(device);

    const presets: Record<string, () => Buffer> = {
      tracking_fast: () =>
        buildEnableTrackingCommand(terminalId, {
          timeIntervalSeconds: 10,
          heartbeatIntervalSeconds: 30,
        }),
      tracking_normal: () =>
        buildEnableTrackingCommand(terminalId, {
          timeIntervalSeconds: 30,
          heartbeatIntervalSeconds: 60,
        }),
      tracking_slow: () =>
        buildEnableTrackingCommand(terminalId, {
          timeIntervalSeconds: 120,
          heartbeatIntervalSeconds: 180,
        }),
      gps_force: () =>
        buildForceGpsCommand(terminalId, {
          timeIntervalSeconds: 15,
          heartbeatIntervalSeconds: 30,
          positionAccuracyMeters: 10,
          gnssPositionQuality: 1,
          locationStatus: 1,
        }),
    };

    const builder = presets[preset];

    if (!builder) {
      return { ok: false, message: `Preset desconocido: ${preset}` };
    }

    const command = builder();

    return this.sendOrQueue(
      terminalId,
      command,
      `PRESET_${preset.toUpperCase()}`,
      deviceId,
      {
        preset,
        operatorName: operatorName ?? 'admin',
      },
    );
  }

  private async findDeviceOrFail(deviceId: string) {
    const device = await this.prisma.device.findFirst({
      where: { id: deviceId, deletedAt: null },
    });

    if (!device) {
      throw new NotFoundException(`Dispositivo no encontrado: ${deviceId}`);
    }

    return device;
  }

  private resolveTerminalId(device: {
    imei?: string | null;
    serialNumber?: string | null;
    deviceId?: string | null;
    providerId?: string | null;
    id: string;
  }): string {
    return (
      device.imei ||
      device.serialNumber ||
      device.deviceId ||
      device.providerId ||
      device.id
    ).toUpperCase();
  }

  private async logCommand(params: {
    deviceId: string;
    action: string;
    status: 'PENDING' | 'SENT' | 'QUEUED' | 'ERROR';
    hexSent: string;
    extraData?: Record<string, unknown>;
  }) {
    await this.prisma.deviceParameterCommand
      .create({
        data: {
          id: randomUUID(),
          deviceId: params.deviceId,
          commandType: params.action,
          status: params.status,
          requestedPayload: {
            hexSent: params.hexSent,
            ...(params.extraData ?? {}),
          },
          requestedById:
            typeof params.extraData?.operatorName === 'string'
              ? params.extraData.operatorName
              : undefined,
        },
      })
      .catch(() => {});
  }

  private async sendOrQueue(
    terminalId: string,
    command: Buffer,
    action: string,
    deviceId: string,
    extraData?: Record<string, unknown>,
  ) {
    const tcpDevice = this.registry.getDeviceByTerminalId(terminalId);
    const hexSent = command.toString('hex').toUpperCase();

    if (tcpDevice?.socket && !tcpDevice.socket.destroyed) {
      tcpDevice.socket.write(command);

      await this.logCommand({
        deviceId,
        action,
        status: 'SENT',
        hexSent,
        extraData,
      });

      return {
        ok: true,
        terminalId,
        action,
        sent: true,
        queued: false,
        hexSent,
        message: `Comando ${action} enviado por TCP`,
        ...extraData,
      };
    }

    this.registry.queueCommand(terminalId, command);

    await this.logCommand({
      deviceId,
      action,
      status: 'QUEUED',
      hexSent,
      extraData,
    });

    return {
      ok: true,
      terminalId,
      action,
      sent: false,
      queued: true,
      hexSent,
      message: `Comando ${action} encolado — se enviará cuando el dispositivo se conecte`,
      ...extraData,
    };
  }
}
