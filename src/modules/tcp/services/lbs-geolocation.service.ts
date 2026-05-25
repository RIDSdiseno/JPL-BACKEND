import { Injectable, Logger } from '@nestjs/common';
import type { HHDLbsCell } from '../protocols/hhd-protocol';

export interface LbsResolvedLocation {
  latitude: number;
  longitude: number;
  accuracy?: number;
  source: 'LBS';
}

interface GoogleGeolocationResponse {
  location?: {
    lat?: number;
    lng?: number;
  };
  accuracy?: number;
}

@Injectable()
export class LbsGeolocationService {
  private readonly logger = new Logger(LbsGeolocationService.name);

  async resolve(cells: HHDLbsCell[]): Promise<LbsResolvedLocation | null> {
    const apiKey = process.env.GOOGLE_GEOLOCATION_API_KEY;

    if (!apiKey) {
      this.logger.warn('Falta GOOGLE_GEOLOCATION_API_KEY en .env');
      return null;
    }

    const validCells = cells.filter((cell) => this.isValidCell(cell));

    if (!validCells.length) {
      return null;
    }

    try {
      const response = await fetch(
        `https://www.googleapis.com/geolocation/v1/geolocate?key=${apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            considerIp: false,
            cellTowers: validCells.map((cell) => ({
              mobileCountryCode: cell.mcc,
              mobileNetworkCode: cell.mnc,
              locationAreaCode: cell.lac,
              cellId: cell.cellId,
              signalStrength:
                typeof cell.rxl === 'number' ? -Math.abs(cell.rxl) : undefined,
            })),
          }),
        },
      );

      if (!response.ok) {
        const text = await response.text();

        this.logger.warn(
          `Google Geolocation respondió ${response.status}: ${text}`,
        );

        return null;
      }

      const data = (await response.json()) as GoogleGeolocationResponse;

      const lat = data.location?.lat;
      const lng = data.location?.lng;

      if (
        typeof lat !== 'number' ||
        typeof lng !== 'number' ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        lat < -90 ||
        lat > 90 ||
        lng < -180 ||
        lng > 180
      ) {
        return null;
      }

      return {
        latitude: lat,
        longitude: lng,
        accuracy: data.accuracy,
        source: 'LBS',
      };
    } catch (error) {
      this.logger.error(
        `Error resolviendo LBS: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return null;
    }
  }

  private isValidCell(cell: HHDLbsCell): boolean {
    return (
      Number.isFinite(cell.mcc) &&
      Number.isFinite(cell.mnc) &&
      Number.isFinite(cell.lac) &&
      Number.isFinite(cell.cellId) &&
      cell.mcc > 0 &&
      cell.mnc >= 0 &&
      cell.lac > 0 &&
      cell.cellId > 0
    );
  }
}
