import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import * as net from 'net';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../config/prisma/prisma.service';
import {
  buildHHDResponse8001,
  parseHHDPacket,
  parseHHDPosition,
} from './protocols/hhd-protocol';
import { TcpDeviceRegistryService } from './registry/tcp-device-registry.service';

@Injectable()
export class TcpGateway implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TcpGateway.name);
  private server: net.Server | null = null;

  constructor(
    private readonly registry: TcpDeviceRegistryService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    const port = Number(process.env.TCP_PORT ?? 5000);

    this.server = net.createServer((socket) => {
      const socketId = this.getSocketId(socket);
      const ip = socket.remoteAddress ?? 'unknown';

      this.registry.addConnection({
        id: socketId,
        terminalId: '',
        socket,
        ip,
        remotePort: socket.remotePort,
        connectedAt: new Date(),
        lastSeen: new Date(),
        packetsReceived: 0,
      });

      this.logger.log(`Nueva conexión TCP: ${socketId}`);

      socket.on('data', (data: Buffer) => {
        void this.handleData(socket, data);
      });

      socket.on('close', () => {
        this.logger.warn(`Conexión TCP cerrada: ${socketId}`);

        const connection = this.registry.getConnectionBySocketId(socketId);

        if (connection?.terminalId) {
          void this.markDeviceOffline(connection.terminalId);
        }

        this.registry.removeConnection(socketId);
      });

      socket.on('error', (error: Error) => {
        this.logger.error(`Error TCP ${socketId}: ${error.message}`);

        const connection = this.registry.getConnectionBySocketId(socketId);

        if (connection?.terminalId) {
          void this.markDeviceOffline(connection.terminalId);
        }

        this.registry.removeConnection(socketId);
      });
    });

    this.server.listen(port, '0.0.0.0', () => {
      this.logger.log(`Servidor TCP escuchando en puerto ${port}`);
    });
  }

  onModuleDestroy(): void {
    this.server?.close();
  }

  private async handleData(socket: net.Socket, buffer: Buffer): Promise<void> {
    const socketId = this.getSocketId(socket);
    const ip = socket.remoteAddress ?? 'unknown';
    const remotePort = socket.remotePort;
    const hex = buffer.toString('hex').toUpperCase();

    this.registry.touch(socketId);

    const parsed = parseHHDPacket(buffer);

    if (!parsed) {
      this.logger.warn(`Paquete no reconocido HEX=${hex}`);
      return;
    }

    this.registry.updateTerminalId(socketId, parsed.terminalId);

    this.registry.addPacket({
      socketId,
      terminalId: parsed.terminalId,
      ip,
      remotePort,
      size: buffer.length,
      hex,
      receivedAt: new Date(),
    });

    await this.markDeviceOnline(parsed.terminalId);

    this.logger.log(
      `Paquete recibido terminal=${parsed.terminalId} msgId=0x${parsed.msgId
        .toString(16)
        .toUpperCase()} bytes=${buffer.length} HEX=${hex}`,
    );

    const pendingCommands = this.registry.consumePendingCommands(
      parsed.terminalId,
    );

    for (const command of pendingCommands) {
      socket.write(command);
      this.logger.log(`Comando pendiente enviado a ${parsed.terminalId}`);
    }

    if (parsed.msgId === 0x0200) {
      const position = parseHHDPosition(parsed.body);

      this.logger.debug(
        `Position body terminal=${parsed.terminalId} length=${
          parsed.body.length
        } bodyHEX=${parsed.body.toString('hex').toUpperCase()}`,
      );

      if (position) {
        this.logger.log(
          `GPS ${parsed.terminalId}: lat=${position.latitude} lng=${position.longitude} gpsValid=${position.gpsValid} speed=${position.speed} elevation=${position.elevation} status=${position.status} alarmFlag=${position.alarmFlag}`,
        );

        await this.handleGpsPosition(parsed.terminalId, position, hex);
      } else {
        this.logger.warn(
          `No se pudo parsear posición terminal=${parsed.terminalId}`,
        );
      }
    }

    if (parsed.msgId === 0x0210) {
      this.logger.warn(
        `Paquete histórico 0x0210 recibido terminal=${parsed.terminalId}. Se omite parseo GPS simple para evitar coordenadas inválidas.`,
      );
    }

    const response = buildHHDResponse8001(
      parsed.terminalId,
      parsed.serialNumber,
      parsed.msgId,
    );

    socket.write(response);
  }

  private async handleGpsPosition(
    terminalId: string,
    position: NonNullable<ReturnType<typeof parseHHDPosition>>,
    rawHex: string,
  ): Promise<void> {
    const coordsInRange = this.isValidCoordinate(
      position.latitude,
      position.longitude,
    );

    const canUseLocation = position.gpsValid && coordsInRange;

    if (canUseLocation) {
      this.registry.updateLastPosition(terminalId, {
        latitude: position.latitude,
        longitude: position.longitude,
        gpsValid: position.gpsValid,
        speed: position.speed,
        elevation: position.elevation,
        direction: position.direction,
        time: position.time,
      });
    }

    const commonDeviceData = {
      onlineStatus: 'ONLINE',
      lastConnectionAt: new Date(),
      updatedAt: new Date(),
      metadata: {
        gpsValid: position.gpsValid,
        coordsInRange,
        speed: position.speed,
        elevation: position.elevation,
        direction: position.direction,
        gpsTime: position.time,
        source: 'TCP_HHD',
      },
    };

    const locationData = canUseLocation
      ? {
          lastLocationLat: position.latitude,
          lastLocationLng: position.longitude,
        }
      : {};

    await this.prisma.device.updateMany({
      where: {
        OR: [
          { deviceId: terminalId },
          { imei: terminalId },
          { serialNumber: terminalId },
          { providerId: terminalId },
        ],
      },
      data: {
        ...commonDeviceData,
        ...locationData,
      },
    });

    await this.prisma.deviceTelemetry.create({
      data: {
        id: randomUUID(),
        deviceId: terminalId,
        latitude: canUseLocation ? position.latitude : null,
        longitude: canUseLocation ? position.longitude : null,
        speed: position.speed,
        rawPayload: {
          rawHex,
          gpsValid: position.gpsValid,
          coordsInRange,
          parsedLatitude: position.latitude,
          parsedLongitude: position.longitude,
          elevation: position.elevation,
          direction: position.direction,
          gpsTime: position.time,
          source: 'TCP_HHD',
        },
        recordedAt: new Date(),
      },
    });

    if (!canUseLocation) {
      this.logger.warn(
        `GPS no utilizable terminal=${terminalId}. gpsValid=${position.gpsValid} coordsInRange=${coordsInRange}. No se actualizó ubicación.`,
      );
      return;
    }

    this.logger.debug(
      `GPS válido persistido terminal=${terminalId} lat=${position.latitude} lng=${position.longitude}`,
    );
  }

  private async markDeviceOnline(terminalId: string): Promise<void> {
    await this.prisma.device.updateMany({
      where: {
        OR: [
          { deviceId: terminalId },
          { imei: terminalId },
          { serialNumber: terminalId },
          { providerId: terminalId },
        ],
      },
      data: {
        onlineStatus: 'ONLINE',
        lastConnectionAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }

  private async markDeviceOffline(terminalId: string): Promise<void> {
    await this.prisma.device.updateMany({
      where: {
        OR: [
          { deviceId: terminalId },
          { imei: terminalId },
          { serialNumber: terminalId },
          { providerId: terminalId },
        ],
      },
      data: {
        onlineStatus: 'OFFLINE',
        updatedAt: new Date(),
      },
    });

    this.logger.warn(`Dispositivo marcado OFFLINE terminal=${terminalId}`);
  }

  private isValidCoordinate(latitude: number, longitude: number): boolean {
    return (
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      latitude >= -90 &&
      latitude <= 90 &&
      longitude >= -180 &&
      longitude <= 180
    );
  }

  private getSocketId(socket: net.Socket): string {
    return `${socket.remoteAddress}:${socket.remotePort}`;
  }
}
