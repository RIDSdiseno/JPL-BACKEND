export type MonitoringLockStatus = 'ONLINE' | 'OFFLINE' | 'ALARM';

export interface MonitoringLockEntity {
  id: string;
  name: string;
  imei: string;
  status: MonitoringLockStatus;
  latitude: number;
  longitude: number;
  battery: number;
  speed?: number;
  altitude?: number;
  floor?: number;
  lastSeen: Date | string;
}
