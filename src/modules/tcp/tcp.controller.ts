import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  buildCloseCommand,
  buildEnableTrackingCommand,
  buildForceGpsCommand,
  buildOpenCommand,
  buildReadGpsStatusCommand,
} from './protocols/hhd-protocol';
import { TcpDeviceRegistryService } from './registry/tcp-device-registry.service';

@Controller('tcp')
@UseGuards(JwtAuthGuard)
export class TcpController {
  constructor(private readonly registry: TcpDeviceRegistryService) {}

  @Get('stats')
  getStats() {
    return {
      ok: true,
      data: this.registry.getStats(),
    };
  }

  @Get('devices')
  getDevices() {
    return {
      ok: true,
      data: this.registry.getConnectedDevices(),
    };
  }

  @Get('devices/:terminalId')
  getDevice(@Param('terminalId') terminalId: string) {
    const device = this.registry.getDeviceByTerminalId(terminalId);

    return {
      ok: true,
      data: device
        ? {
            id: device.id,
            terminalId: device.terminalId,
            ip: device.ip,
            remotePort: device.remotePort,
            connectedAt: device.connectedAt,
            lastSeen: device.lastSeen,
            packetsReceived: device.packetsReceived,
            lastPosition: device.lastPosition ?? null,
          }
        : null,
    };
  }

  @Get('packets')
  getPackets(@Query('limit') limit?: string) {
    const parsedLimit = Number(limit);

    const safeLimit =
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, 1000)
        : 200;

    return {
      ok: true,
      data: this.registry.getPackets(safeLimit),
    };
  }

  @Post('devices/:terminalId/open')
  openLock(
    @Param('terminalId') terminalId: string,
    @Body() body?: { operatorName?: string },
  ) {
    const normalizedTerminalId = terminalId.toUpperCase();
    const device = this.registry.getDeviceByTerminalId(normalizedTerminalId);
    const command = buildOpenCommand(normalizedTerminalId);

    return this.sendOrQueueCommand({
      terminalId: normalizedTerminalId,
      command,
      device,
      action: 'OPEN',
      operatorName: body?.operatorName,
      sentMessage: 'Comando ABRIR enviado por TCP',
      queuedMessage: 'Comando ABRIR encolado hasta que el candado se conecte',
    });
  }

  @Post('devices/:terminalId/close')
  closeLock(
    @Param('terminalId') terminalId: string,
    @Body() body?: { operatorName?: string },
  ) {
    const normalizedTerminalId = terminalId.toUpperCase();
    const device = this.registry.getDeviceByTerminalId(normalizedTerminalId);
    const command = buildCloseCommand(normalizedTerminalId);

    return this.sendOrQueueCommand({
      terminalId: normalizedTerminalId,
      command,
      device,
      action: 'CLOSE',
      operatorName: body?.operatorName,
      sentMessage: 'Comando CERRAR enviado por TCP',
      queuedMessage: 'Comando CERRAR encolado hasta que el candado se conecte',
    });
  }

  @Post('devices/:terminalId/enable-tracking')
  enableTracking(
    @Param('terminalId') terminalId: string,
    @Body()
    body?: {
      timeIntervalSeconds?: number;
      heartbeatIntervalSeconds?: number;
      operatorName?: string;
    },
  ) {
    const normalizedTerminalId = terminalId.toUpperCase();
    const device = this.registry.getDeviceByTerminalId(normalizedTerminalId);

    const timeIntervalSeconds = this.normalizeNumber(
      body?.timeIntervalSeconds,
      30,
      10,
      86_400,
    );

    const heartbeatIntervalSeconds = this.normalizeNumber(
      body?.heartbeatIntervalSeconds,
      60,
      10,
      86_400,
    );

    const command = buildEnableTrackingCommand(normalizedTerminalId, {
      timeIntervalSeconds,
      heartbeatIntervalSeconds,
    });

    return this.sendOrQueueCommand({
      terminalId: normalizedTerminalId,
      command,
      device,
      action: 'ENABLE_TRACKING',
      operatorName: body?.operatorName,
      sentMessage: `Configuración de tracking enviada por TCP cada ${timeIntervalSeconds}s`,
      queuedMessage:
        'Configuración de tracking encolada hasta que el candado se conecte',
      extraData: {
        timeIntervalSeconds,
        heartbeatIntervalSeconds,
      },
    });
  }

  @Post('devices/:terminalId/force-gps')
  forceGps(
    @Param('terminalId') terminalId: string,
    @Body()
    body?: {
      timeIntervalSeconds?: number;
      heartbeatIntervalSeconds?: number;
      positionAccuracyMeters?: number;
      gnssPositionQuality?: number;
      locationStatus?: number;
      operatorName?: string;
    },
  ) {
    const normalizedTerminalId = terminalId.toUpperCase();
    const device = this.registry.getDeviceByTerminalId(normalizedTerminalId);

    const timeIntervalSeconds = this.normalizeNumber(
      body?.timeIntervalSeconds,
      30,
      10,
      86_400,
    );

    const heartbeatIntervalSeconds = this.normalizeNumber(
      body?.heartbeatIntervalSeconds,
      60,
      10,
      86_400,
    );

    const positionAccuracyMeters = this.normalizeNumber(
      body?.positionAccuracyMeters,
      10,
      1,
      500,
    );

    const gnssPositionQuality = this.normalizeNumber(
      body?.gnssPositionQuality,
      1,
      0,
      10,
    );

    const locationStatus = this.normalizeNumber(body?.locationStatus, 1, 0, 10);

    const command = buildForceGpsCommand(normalizedTerminalId, {
      timeIntervalSeconds,
      heartbeatIntervalSeconds,
      positionAccuracyMeters,
      gnssPositionQuality,
      locationStatus,
    });

    return this.sendOrQueueCommand({
      terminalId: normalizedTerminalId,
      command,
      device,
      action: 'FORCE_GPS',
      operatorName: body?.operatorName,
      sentMessage: 'Comando GPS forzado enviado por TCP',
      queuedMessage:
        'Comando GPS forzado encolado hasta que el candado se conecte',
      extraData: {
        timeIntervalSeconds,
        heartbeatIntervalSeconds,
        positionAccuracyMeters,
        gnssPositionQuality,
        locationStatus,
      },
    });
  }

  @Post('devices/:terminalId/read-gps-status')
  readGpsStatus(
    @Param('terminalId') terminalId: string,
    @Body() body?: { operatorName?: string },
  ) {
    const normalizedTerminalId = terminalId.toUpperCase();
    const device = this.registry.getDeviceByTerminalId(normalizedTerminalId);
    const command = buildReadGpsStatusCommand(normalizedTerminalId);

    return this.sendOrQueueCommand({
      terminalId: normalizedTerminalId,
      command,
      device,
      action: 'READ_GPS_STATUS',
      operatorName: body?.operatorName,
      sentMessage: 'Lectura de estado GPS enviada por TCP',
      queuedMessage:
        'Lectura de estado GPS encolada hasta que el candado se conecte',
    });
  }

  private sendOrQueueCommand(args: {
    terminalId: string;
    command: Buffer;
    device?: {
      socket?: {
        destroyed?: boolean;
        write: (buffer: Buffer) => void;
      };
    };
    action:
      | 'OPEN'
      | 'CLOSE'
      | 'ENABLE_TRACKING'
      | 'FORCE_GPS'
      | 'READ_GPS_STATUS';
    operatorName?: string;
    sentMessage: string;
    queuedMessage: string;
    extraData?: Record<string, unknown>;
  }) {
    const {
      terminalId,
      command,
      device,
      action,
      operatorName,
      sentMessage,
      queuedMessage,
      extraData,
    } = args;

    if (device?.socket && !device.socket.destroyed) {
      device.socket.write(command);

      return {
        ok: true,
        data: {
          terminalId,
          action,
          sent: true,
          queued: false,
          operatorName: operatorName ?? 'admin',
          hexSent: command.toString('hex').toUpperCase(),
          message: sentMessage,
          ...extraData,
        },
      };
    }

    this.registry.queueCommand(terminalId, command);

    return {
      ok: true,
      data: {
        terminalId,
        action,
        sent: false,
        queued: true,
        operatorName: operatorName ?? 'admin',
        hexSent: command.toString('hex').toUpperCase(),
        message: queuedMessage,
        ...extraData,
      },
    };
  }

  private normalizeNumber(
    value: unknown,
    fallback: number,
    min: number,
    max: number,
  ): number {
    const parsed = Number(value);

    if (!Number.isFinite(parsed)) {
      return fallback;
    }

    return Math.min(Math.max(Math.trunc(parsed), min), max);
  }
}
