import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma/prisma.service';
import { TcpDeviceRegistryService } from '../../modules/tcp/registry/tcp-device-registry.service';
import type {
  MonitoringLockEntity,
  MonitoringLockStatus,
  MonitoringLocationSource,
} from './entities/monitoring-lock.entity';
import type { MonitoringLocksResponseDto } from './dto/monitoring-lock-response.dto';

interface DeviceMetadata {
  gpsValid?: boolean;
  coordsInRange?: boolean;
  locationSource?: MonitoringLocationSource;
  resolvedLbsLocation?: {
    latitude?: number;
    longitude?: number;
    accuracy?: number | null;
    source?: 'LBS';
  } | null;
  batteryLevel?: number | null;
  csq?: number | null;
  satellites?: number | null;
  speed?: number | null;
  elevation?: number | null;
  direction?: number | null;
  gpsTime?: string | null;
  source?: string;
}

@Injectable()
export class MonitoringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tcpRegistry: TcpDeviceRegistryService,
  ) {}

  async getLocks(): Promise<MonitoringLocksResponseDto> {
    const devices = await this.prisma.device.findMany({
      where: {
        deletedAt: null,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    const locks: MonitoringLockEntity[] = devices
      .filter((device) =>
        this.isLockDevice(device.deviceType, device.productModel),
      )
      .map((device) => {
        const terminalId = this.getTerminalId(device);
        const tcpDevice = this.tcpRegistry.getDeviceByTerminalId(terminalId);
        const lastPosition = tcpDevice?.lastPosition;
        const metadata = this.parseMetadata(device.metadata);

        const latitude =
          this.toNullableNumber(lastPosition?.latitude) ??
          this.toNullableNumber(device.lastLocationLat) ??
          this.toNullableNumber(metadata.resolvedLbsLocation?.latitude);

        const longitude =
          this.toNullableNumber(lastPosition?.longitude) ??
          this.toNullableNumber(device.lastLocationLng) ??
          this.toNullableNumber(metadata.resolvedLbsLocation?.longitude);

        const hasLocation =
          typeof latitude === 'number' && typeof longitude === 'number';

        const status: MonitoringLockStatus = tcpDevice ? 'ONLINE' : 'OFFLINE';

        const locationSource = this.resolveLocationSource(
          metadata.locationSource,
          lastPosition?.gpsValid,
          hasLocation,
        );

        return {
          id: device.id,
          name: device.name || `Candado ${terminalId}`,
          imei: terminalId,
          status,

          latitude,
          longitude,

          battery: this.toNullableNumber(metadata.batteryLevel),
          speed:
            this.toNullableNumber(lastPosition?.speed) ??
            this.toNullableNumber(metadata.speed) ??
            0,
          altitude:
            this.toNullableNumber(lastPosition?.elevation) ??
            this.toNullableNumber(metadata.elevation) ??
            undefined,

          floor: undefined,

          lastSeen: tcpDevice?.lastSeen ?? device.updatedAt ?? device.createdAt,

          locationSource,
          gpsValid: lastPosition?.gpsValid ?? metadata.gpsValid ?? false,
          coordsInRange: metadata.coordsInRange ?? hasLocation,
          locationAccuracy:
            this.toNullableNumber(metadata.resolvedLbsLocation?.accuracy) ??
            undefined,

          satellites: this.toNullableNumber(metadata.satellites) ?? undefined,
          csq: this.toNullableNumber(metadata.csq) ?? undefined,

          onlineFromTcp: Boolean(tcpDevice),
        };
      });

    return {
      locks,
      summary: {
        total: locks.length,
        online: locks.filter((lock) => lock.status === 'ONLINE').length,
        offline: locks.filter((lock) => lock.status === 'OFFLINE').length,
        alarm: locks.filter((lock) => lock.status === 'ALARM').length,
        withLocation: locks.filter((lock) => this.hasValidLocation(lock))
          .length,
        withoutLocation: locks.filter((lock) => !this.hasValidLocation(lock))
          .length,
      },
    };
  }

  private isLockDevice(deviceType: unknown, productModel: unknown): boolean {
    const type = typeof deviceType === 'string' ? deviceType.toUpperCase() : '';

    const model =
      typeof productModel === 'string' ? productModel.toUpperCase() : '';

    return (
      type.includes('LOCK') ||
      type.includes('SEAL') ||
      model.includes('LOCK') ||
      model.includes('SEAL') ||
      type === 'SMART_LOCK' ||
      type === 'E_SEAL'
    );
  }

  private getTerminalId(device: {
    id: string;
    imei?: string | null;
    serialNumber?: string | null;
    deviceId?: string | null;
    providerId?: string | null;
  }): string {
    const terminalId =
      device.imei ||
      device.serialNumber ||
      device.deviceId ||
      device.providerId ||
      device.id;

    return terminalId.toUpperCase();
  }

  private parseMetadata(metadata: unknown): DeviceMetadata {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return {};
    }

    return metadata;
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

  private hasValidLocation(lock: MonitoringLockEntity): boolean {
    return (
      typeof lock.latitude === 'number' &&
      Number.isFinite(lock.latitude) &&
      typeof lock.longitude === 'number' &&
      Number.isFinite(lock.longitude)
    );
  }

  private resolveLocationSource(
    source: unknown,
    gpsValid: boolean | undefined,
    hasLocation: boolean,
  ): MonitoringLocationSource {
    if (source === 'GPS' || source === 'LBS' || source === 'WIFI') {
      return source;
    }

    if (gpsValid && hasLocation) {
      return 'GPS';
    }

    return hasLocation ? 'GPS' : 'INVALID';
  }
}
