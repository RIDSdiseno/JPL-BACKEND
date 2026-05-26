export type MonitoringLockStatus = 'ONLINE' | 'OFFLINE' | 'ALARM';

export type MonitoringLocationSource = 'GPS' | 'LBS' | 'WIFI' | 'INVALID';

export interface MonitoringLockEntity {
  id: string;
  name: string;
  imei: string;
  status: MonitoringLockStatus;

  latitude: number | null;
  longitude: number | null;

  battery: number | null;
  batteryVoltage: number | null;

  speed: number;
  altitude?: number;
  floor?: number;

  lastSeen: Date | string;

  locationSource: MonitoringLocationSource;
  gpsValid: boolean;
  coordsInRange: boolean;
  locationAccuracy?: number;

  locationStatusCode?: number;
  gpsPositionStatus?: number;

  satellites?: number;
  csq?: number;

  onlineFromTcp: boolean;
}
