import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import * as net from 'net';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../config/prisma/prisma.service';
import {
  buildHHDResponse8001,
  parseHHDParameterReport0313,
  parseHHDPacket,
  parseHHDPosition,
} from './protocols/hhd-protocol';
import { TcpDeviceRegistryService } from './registry/tcp-device-registry.service';
import { LbsGeolocationService } from './services/lbs-geolocation.service';

@Injectable()
export class TcpGateway implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TcpGateway.name);
  private server: net.Server | null = null;

  constructor(
    private readonly registry: TcpDeviceRegistryService,
    private readonly prisma: PrismaService,
    private readonly lbsGeolocation: LbsGeolocationService,
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

      socket.on('end', () => {
        this.logger.warn(`Socket END recibido: ${socketId}`);
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
      this.logger.log(
        `Comando pendiente enviado a ${
          parsed.terminalId
        } HEX=${command.toString('hex').toUpperCase()}`,
      );
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
          `GPS ${parsed.terminalId}: lat=${position.latitude} lng=${
            position.longitude
          } gpsValid=${position.gpsValid} source=${
            position.locationSource
          } locationStatus=${position.locationStatusCode} gpsPositionStatus=${
            position.gpsPositionStatus
          } lbsCells=${position.lbsCells.length} satellites=${
            position.satellites ?? 'N/A'
          } csq=${position.csq ?? 'N/A'} battery=${
            position.batteryLevel ?? 'N/A'
          } batteryVoltage=${position.batteryVoltage ?? 'N/A'} speed=${
            position.speed
          } status=${position.status}`,
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

    if (parsed.msgId === 0x0311) {
      this.logger.log(
        `Respuesta comando 0310 terminal=${
          parsed.terminalId
        } bodyHEX=${parsed.body.toString('hex').toUpperCase()}`,
      );
    }

    if (parsed.msgId === 0x0313) {
      const report = parseHHDParameterReport0313(parsed.body);

      this.logger.log(
        `Reporte parámetros 0313 terminal=${
          parsed.terminalId
        } data=${JSON.stringify(report)} bodyHEX=${parsed.body
          .toString('hex')
          .toUpperCase()}`,
      );

      await this.handleParameterReport(parsed.terminalId, report, hex);
    }

    const response = buildHHDResponse8001(
      parsed.terminalId,
      parsed.serialNumber,
      parsed.msgId,
    );

    socket.write(response);
  }

  private async handleParameterReport(
    terminalId: string,
    report: Record<string, string | number>,
    rawHex: string,
  ): Promise<void> {
    const metadata = {
      source: 'TCP_HHD_PARAMETER_REPORT',
      parameterReport: report,
      parameterReportRawHex: rawHex,
      parameterReportAt: new Date().toISOString(),
      batteryVoltage: this.toNullableNumber(report.BatteryVoltage),
      terminalAlarmBatteryLevel: this.toNullableNumber(
        report.TerminalAlarmBatteryLevel,
      ),
      gpsLocationInfo:
        typeof report.GPSlocationInfo === 'string'
          ? report.GPSlocationInfo
          : report.GPSlocationInfo !== undefined
            ? String(report.GPSlocationInfo)
            : null,
      gnssPositionQuality: this.toNullableNumber(report.GNSSPositionQuality),
      locationStatusCode: this.toNullableNumber(report.LocationStatus),
      gpsPositionStatus: this.toNullableNumber(report.RealTimeLocStatus),
      deviceStatus:
        typeof report.DeviceStatus === 'string'
          ? report.DeviceStatus
          : report.DeviceStatus !== undefined
            ? String(report.DeviceStatus)
            : null,
      positionAccuracy: this.toNullableNumber(report.PositionAccuracy),
    } satisfies Prisma.InputJsonObject;

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
        metadata,
      },
    });
  }

  private async handleGpsPosition(
    terminalId: string,
    position: NonNullable<ReturnType<typeof parseHHDPosition>>,
    rawHex: string,
  ): Promise<void> {
    const coordsInRange =
      position.coordsInRange &&
      this.isValidCoordinate(position.latitude, position.longitude);

    const canUseGpsLocation =
      position.locationSource === 'GPS' && coordsInRange;

    const hasLbs =
      position.locationSource === 'LBS' && position.lbsCells.length > 0;

    const lbsLocation = hasLbs
      ? await this.lbsGeolocation.resolve(position.lbsCells)
      : null;

    const canUseLbsLocation =
      !!lbsLocation &&
      this.isValidCoordinate(lbsLocation.latitude, lbsLocation.longitude);

    if (canUseGpsLocation) {
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

    if (canUseLbsLocation && lbsLocation) {
      this.registry.updateLastPosition(terminalId, {
        latitude: lbsLocation.latitude,
        longitude: lbsLocation.longitude,
        gpsValid: false,
        speed: position.speed,
        elevation: position.elevation,
        direction: position.direction,
        time: position.time,
      });
    }

    const lbsCellsJson = position.lbsCells.map((cell) => ({
      mcc: cell.mcc,
      mnc: cell.mnc,
      lac: cell.lac,
      cellId: cell.cellId,
      rxl: cell.rxl ?? null,
    }));

    const resolvedLbsLocation = lbsLocation
      ? {
          latitude: lbsLocation.latitude,
          longitude: lbsLocation.longitude,
          accuracy: lbsLocation.accuracy ?? null,
          source: lbsLocation.source,
        }
      : null;

    const metadata = {
      gpsValid: position.gpsValid,
      coordsInRange,
      locationSource: canUseGpsLocation
        ? 'GPS'
        : canUseLbsLocation
          ? 'LBS'
          : position.locationSource,
      locationStatusCode: position.locationStatusCode,
      gpsPositionStatus: position.gpsPositionStatus,
      lbsCells: lbsCellsJson,
      resolvedLbsLocation,
      batteryLevel: position.batteryLevel ?? null,
      batteryVoltage: position.batteryVoltage ?? null,
      csq: position.csq ?? null,
      satellites: position.satellites ?? null,
      speed: position.speed,
      elevation: position.elevation,
      direction: position.direction,
      gpsTime: position.time,
      source: 'TCP_HHD',
    } satisfies Prisma.InputJsonObject;

    const rawPayload = {
      rawHex,
      gpsValid: position.gpsValid,
      coordsInRange,
      locationSource: position.locationSource,
      locationStatusCode: position.locationStatusCode,
      gpsPositionStatus: position.gpsPositionStatus,
      lbsCells: lbsCellsJson,
      resolvedLbsLocation,
      hasLbs,
      parsedLatitude: position.latitude,
      parsedLongitude: position.longitude,
      batteryLevel: position.batteryLevel ?? null,
      batteryVoltage: position.batteryVoltage ?? null,
      csq: position.csq ?? null,
      satellites: position.satellites ?? null,
      elevation: position.elevation,
      direction: position.direction,
      gpsTime: position.time,
      source: 'TCP_HHD',
    } satisfies Prisma.InputJsonObject;

    const commonDeviceData = {
      onlineStatus: 'ONLINE',
      lastConnectionAt: new Date(),
      updatedAt: new Date(),
      metadata,
    };

    const locationData = canUseGpsLocation
      ? {
          lastLocationLat: position.latitude,
          lastLocationLng: position.longitude,
        }
      : canUseLbsLocation && lbsLocation
        ? {
            lastLocationLat: lbsLocation.latitude,
            lastLocationLng: lbsLocation.longitude,
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
        latitude: canUseGpsLocation
          ? position.latitude
          : canUseLbsLocation && lbsLocation
            ? lbsLocation.latitude
            : null,
        longitude: canUseGpsLocation
          ? position.longitude
          : canUseLbsLocation && lbsLocation
            ? lbsLocation.longitude
            : null,
        speed: position.speed,
        rawPayload,
        recordedAt: new Date(),
      },
    });

    if (canUseGpsLocation) {
      this.logger.debug(
        `GPS real persistido terminal=${terminalId} lat=${position.latitude} lng=${position.longitude}`,
      );
      return;
    }

    if (canUseLbsLocation && lbsLocation) {
      this.logger.debug(
        `LBS persistido terminal=${terminalId} lat=${lbsLocation.latitude} lng=${lbsLocation.longitude} accuracy=${lbsLocation.accuracy ?? 'N/A'}`,
      );
      return;
    }

    if (hasLbs) {
      this.logger.warn(
        `LBS detectado terminal=${terminalId}, pero no se pudo resolver con Google.`,
      );
      return;
    }

    this.logger.warn(
      `Ubicación no utilizable terminal=${terminalId}. source=${position.locationSource} gpsValid=${position.gpsValid} coordsInRange=${coordsInRange}.`,
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

  private toNullableNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
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
