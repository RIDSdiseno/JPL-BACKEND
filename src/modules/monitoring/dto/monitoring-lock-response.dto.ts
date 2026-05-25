import type { MonitoringLockEntity } from '../entities/monitoring-lock.entity';

export interface MonitoringLocksResponseDto {
  locks: MonitoringLockEntity[];
  summary: {
    total: number;
    online: number;
    offline: number;
    alarm: number;
  };
}
