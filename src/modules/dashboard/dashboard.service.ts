import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma/prisma.service';

const DEVICE_TYPES = [
  'SMART_LOCK',
  'SMART_SENSOR',
  'GPS_TRACKER',
  'E_SEAL',
  'SMART_GATEWAY',
  'SMART_BOX',
] as const;

const CONNECTION_STATUSES = [
  'ONLINE',
  'OFFLINE',
  'SLEEP',
  'LOST_SIGNAL',
  'UNKNOWN',
] as const;

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary() {
    const devices = await this.prisma.device.findMany({
      where: {
        deletedAt: null,
      },
      select: {
        id: true,
        deviceId: true,
        name: true,
        deviceType: true,
        productModel: true,
        onlineStatus: true,
        batteryLevel: true,
        signalStrength: true,
        lockStatus: true,
        lastConnectionAt: true,
        updatedAt: true,
      },
    });

    const devicesByType = DEVICE_TYPES.map((type) => ({
      type,
      total: devices.filter(
        (device) => this.normalizeDeviceType(device.deviceType) === type,
      ).length,
    }));

    const operationRatio = CONNECTION_STATUSES.map((status) => ({
      status,
      total: devices.filter(
        (device) => this.normalizeOnlineStatus(device.onlineStatus) === status,
      ).length,
    }));

    const pushEvents = await this.prisma.devicePushEvent.findMany({
      orderBy: {
        createdAt: 'desc',
      },
      take: 5,
      select: {
        id: true,
        deviceId: true,
        sendingEventType: true,
        sendingStatus: true,
        sendingContent: true,
        sendTime: true,
        createdAt: true,
      },
    });

    const alarmEvents = await this.prisma.deviceAlarmEvent.findMany({
      orderBy: {
        createdAt: 'desc',
      },
      take: 5,
      select: {
        id: true,
        deviceId: true,
        deviceName: true,
        alarmType: true,
        alarmLevel: true,
        description: true,
        batteryLevel: true,
        gpsTime: true,
        createdAt: true,
      },
    });

    return {
      devicesByType,
      operationRatio,
      systemMessages: [
        {
          id: 'system-online',
          titulo: 'Sistema operativo',
          descripcion: `Plataforma conectada con ${devices.length} dispositivo(s).`,
          fecha: new Date().toISOString(),
        },
      ],
      pushEvents: pushEvents.map((event) => ({
        id: event.id,
        mensaje:
          event.sendingContent ??
          `${event.sendingEventType} - ${event.sendingStatus}`,
        dispositivo: event.deviceId ?? 'Sin dispositivo',
        fecha: (event.sendTime ?? event.createdAt).toISOString(),
      })),
      alarmEvents: alarmEvents.map((event) => ({
        id: event.id,
        deviceId: event.deviceId,
        deviceName: event.deviceName,
        type: event.alarmType,
        severity: event.alarmLevel,
        description: event.description,
        batteryLevel: event.batteryLevel,
        dateTime: (event.gpsTime ?? event.createdAt).toISOString(),
      })),
    };
  }

  private normalizeDeviceType(
    type: string | null,
  ): (typeof DEVICE_TYPES)[number] {
    const normalized = String(type ?? '').toUpperCase();

    if (
      normalized.includes('LOCK') ||
      normalized.includes('G_LOCK') ||
      normalized.includes('CANDADO')
    ) {
      return 'SMART_LOCK';
    }

    if (normalized.includes('SENSOR')) return 'SMART_SENSOR';
    if (normalized.includes('GPS')) return 'GPS_TRACKER';
    if (normalized.includes('SEAL')) return 'E_SEAL';
    if (normalized.includes('GATEWAY')) return 'SMART_GATEWAY';
    if (normalized.includes('BOX')) return 'SMART_BOX';

    return 'SMART_LOCK';
  }

  private normalizeOnlineStatus(
    status: string | null,
  ): (typeof CONNECTION_STATUSES)[number] {
    const normalized = String(status ?? '').toUpperCase();

    if (normalized === 'ONLINE' || normalized === 'CONNECTED') {
      return 'ONLINE';
    }

    if (normalized === 'SLEEP') return 'SLEEP';
    if (normalized === 'LOST_SIGNAL') return 'LOST_SIGNAL';
    if (normalized === 'UNKNOWN') return 'UNKNOWN';

    return 'OFFLINE';
  }
}
