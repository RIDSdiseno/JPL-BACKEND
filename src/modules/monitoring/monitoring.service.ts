import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma/prisma.service';
import { TcpDeviceRegistryService } from '../../modules/tcp/registry/tcp-device-registry.service';
import type {
  MonitoringLockEntity,
  MonitoringLockStatus,
} from './entities/monitoring-lock.entity';
import type { MonitoringLocksResponseDto } from './dto/monitoring-lock-response.dto';

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
      .filter((device) => {
        const type = String(device.deviceType ?? '').toUpperCase();
        const model = String(device.productModel ?? '').toUpperCase();

        return (
          type.includes('LOCK') ||
          type.includes('SEAL') ||
          model.includes('LOCK') ||
          model.includes('SEAL') ||
          type === 'SMART_LOCK' ||
          type === 'E_SEAL'
        );
      })
      .map((device, index) => {
        const terminalId =
          device.imei || device.serialNumber || device.deviceId || device.id;

        const tcpDevice = this.tcpRegistry.getDeviceByTerminalId(terminalId);
        const lastPosition = tcpDevice?.lastPosition;

        const status: MonitoringLockStatus = tcpDevice ? 'ONLINE' : 'OFFLINE';

        const fallbackCoords = this.getDemoCoordinates(index);

        return {
          id: device.id,
          name: device.name || `Candado ${terminalId}`,
          imei: terminalId,
          status,
          latitude: lastPosition?.latitude ?? fallbackCoords.latitude,
          longitude: lastPosition?.longitude ?? fallbackCoords.longitude,
          battery: 0,
          speed: lastPosition?.speed ?? 0,
          altitude: lastPosition?.elevation,
          floor: undefined,
          lastSeen: tcpDevice?.lastSeen ?? device.updatedAt ?? device.createdAt,
        };
      });

    return {
      locks,
      summary: {
        total: locks.length,
        online: locks.filter((lock) => lock.status === 'ONLINE').length,
        offline: locks.filter((lock) => lock.status === 'OFFLINE').length,
        alarm: locks.filter((lock) => lock.status === 'ALARM').length,
      },
    };
  }

  private getDemoCoordinates(index: number): {
    latitude: number;
    longitude: number;
  } {
    const baseLatitude = -33.4489;
    const baseLongitude = -70.6693;

    const offsets = [
      { latitude: 0, longitude: 0 },
      { latitude: -0.006, longitude: 0.004 },
      { latitude: 0.005, longitude: 0.007 },
      { latitude: -0.003, longitude: -0.006 },
      { latitude: 0.004, longitude: -0.004 },
    ];

    const offset = offsets[index % offsets.length];

    return {
      latitude: baseLatitude + offset.latitude,
      longitude: baseLongitude + offset.longitude,
    };
  }
}
