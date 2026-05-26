export interface HHDPacket {
  msgId: number;
  msgLength: number;
  terminalId: string;
  serialNumber: number;
  body: Buffer;
}

export interface HHDLbsCell {
  mcc: number;
  mnc: number;
  lac: number;
  cellId: number;
  rxl?: number;
}

export interface HHDPosition {
  alarmFlag: number;
  status: number;
  latitude: number;
  longitude: number;
  elevation: number;
  speed: number;
  direction: number;
  time: string;
  isSealed: boolean;
  isShackleClosed: boolean;
  gpsValid: boolean;
  coordsInRange: boolean;
  locationSource: 'GPS' | 'LBS' | 'WIFI' | 'INVALID';
  locationStatusCode: 0 | 1 | 2 | 3;
  gpsPositionStatus: 0 | 1 | 2 | 3;
  lbsCells: HHDLbsCell[];
  batteryLevel?: number;
  batteryVoltage?: number;
  csq?: number;
  satellites?: number;
}

let serverSerialNumber = 1;

function getNextSerialNumber(): number {
  const current = serverSerialNumber;

  serverSerialNumber += 1;

  if (serverSerialNumber > 0xffff) {
    serverSerialNumber = 1;
  }

  return current;
}

function unescapeBuffer(buffer: Buffer): Buffer {
  const result: number[] = [];

  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i];

    if (byte === 0x7d) {
      i++;
      if (i >= buffer.length) break;

      const next = buffer[i];

      if (next === 0x02) result.push(0x7e);
      else if (next === 0x01) result.push(0x7d);
      else result.push(next);
    } else {
      result.push(byte);
    }
  }

  return Buffer.from(result);
}

function escapeBuffer(buffer: Buffer): Buffer {
  const result: number[] = [];

  for (const byte of buffer) {
    if (byte === 0x7e) result.push(0x7d, 0x02);
    else if (byte === 0x7d) result.push(0x7d, 0x01);
    else result.push(byte);
  }

  return Buffer.from(result);
}

function checksum(buffer: Buffer): number {
  let value = 0;

  for (const byte of buffer) {
    value ^= byte;
  }

  return value;
}

function decodeBcd(value: number): string {
  return value.toString(16).padStart(2, '0');
}

function decodeCoordinate(raw: number): number {
  return raw / 1_000_000;
}

function isValidCoordinate(latitude: number, longitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function isLikelyChileCoordinate(latitude: number, longitude: number): boolean {
  return (
    latitude >= -56 && latitude <= -17 && longitude >= -76 && longitude <= -66
  );
}

function intTo1Byte(value: number): Buffer {
  const buffer = Buffer.alloc(1);
  buffer.writeUInt8(value);
  return buffer;
}

function intTo2Bytes(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16BE(value);
  return buffer;
}

function intTo4Bytes(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
}

function normalizeTerminalId(terminalId: string): string {
  const normalizedTerminalId = terminalId.toUpperCase();

  if (!/^[0-9A-F]{12}$/.test(normalizedTerminalId)) {
    throw new Error(
      `terminalId inválido para JT808. Debe tener 12 caracteres HEX: ${terminalId}`,
    );
  }

  return normalizedTerminalId;
}

function build0310Param(parameterIdHex: string, content: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(parameterIdHex, 'hex'),
    Buffer.from([content.length]),
    content,
  ]);
}

function buildJT808Message(
  msgId: number,
  terminalId: string,
  body: Buffer,
  serialNumber = getNextSerialNumber(),
): Buffer {
  const normalizedTerminalId = normalizeTerminalId(terminalId);

  const header = Buffer.alloc(12);

  header.writeUInt16BE(msgId, 0);
  header.writeUInt16BE(body.length & 0x03ff, 2);
  Buffer.from(normalizedTerminalId, 'hex').copy(header, 4);
  header.writeUInt16BE(serialNumber, 10);

  const packetWithoutChecksum = Buffer.concat([header, body]);
  const check = checksum(packetWithoutChecksum);
  const escaped = escapeBuffer(
    Buffer.concat([packetWithoutChecksum, Buffer.from([check])]),
  );

  return Buffer.concat([Buffer.from([0x7e]), escaped, Buffer.from([0x7e])]);
}

function parseLbsAttribute66(hex: string): HHDLbsCell[] {
  const cells: HHDLbsCell[] = [];

  try {
    let offset = 0;

    if (hex.length < 22) return cells;

    const mcc = parseInt(hex.slice(offset, offset + 4), 16);
    offset += 4;

    const rxl1 = parseInt(hex.slice(offset, offset + 2), 16);
    offset += 2;

    const mnc1 = parseInt(hex.slice(offset, offset + 4), 16);
    offset += 4;

    const cellId1 = parseInt(hex.slice(offset, offset + 8), 16);
    offset += 8;

    const lac1 = parseInt(hex.slice(offset, offset + 4), 16);
    offset += 4;

    cells.push({
      mcc,
      mnc: mnc1,
      lac: lac1,
      cellId: cellId1,
      rxl: rxl1,
    });

    if (hex.length >= offset + 18) {
      const rxl2 = parseInt(hex.slice(offset, offset + 2), 16);
      offset += 2;

      const mnc2 = parseInt(hex.slice(offset, offset + 4), 16);
      offset += 4;

      const cellId2 = parseInt(hex.slice(offset, offset + 8), 16);
      offset += 8;

      const lac2 = parseInt(hex.slice(offset, offset + 4), 16);
      offset += 4;

      cells.push({
        mcc,
        mnc: mnc2,
        lac: lac2,
        cellId: cellId2,
        rxl: rxl2,
      });
    }

    if (hex.length >= offset + 18) {
      const rxl3 = parseInt(hex.slice(offset, offset + 2), 16);
      offset += 2;

      const mnc3 = parseInt(hex.slice(offset, offset + 4), 16);
      offset += 4;

      const cellId3 = parseInt(hex.slice(offset, offset + 8), 16);
      offset += 8;

      const lac3 = parseInt(hex.slice(offset, offset + 4), 16);

      cells.push({
        mcc,
        mnc: mnc3,
        lac: lac3,
        cellId: cellId3,
        rxl: rxl3,
      });
    }

    return cells.filter(
      (cell) =>
        Number.isFinite(cell.mcc) &&
        Number.isFinite(cell.mnc) &&
        Number.isFinite(cell.lac) &&
        Number.isFinite(cell.cellId) &&
        cell.mcc > 0 &&
        cell.mnc >= 0 &&
        cell.lac > 0 &&
        cell.cellId > 0,
    );
  } catch {
    return cells;
  }
}

function normalizeBatteryPercent(value: number): number {
  if (value <= 100) return value;

  if (value <= 1000) {
    return Math.round(value / 10);
  }

  if (value <= 10000) {
    return Math.round(value / 100);
  }

  return value;
}

function parseHhdAttributes(body: Buffer) {
  const result: {
    lbsCells: HHDLbsCell[];
    batteryLevel?: number;
    batteryVoltage?: number;
    csq?: number;
    satellites?: number;
    hasWifi?: boolean;
  } = {
    lbsCells: [],
  };

  let offset = 28;

  while (offset + 2 <= body.length) {
    const attributeId = body[offset];
    const length = body[offset + 1];

    offset += 2;

    if (length <= 0 || offset + length > body.length) break;

    const value = body.slice(offset, offset + length);
    const valueHex = value.toString('hex').toUpperCase();

    if (attributeId === 0x66) {
      result.lbsCells = parseLbsAttribute66(valueHex);
    }

    if (attributeId === 0x69 && value.length >= 2) {
      const raw = value.readUInt16BE(0);

      // En el SDK este atributo aparece como BatteryVoltage.
      // En varios equipos viene como centivoltios: 0192 = 402 = 4.02V.
      result.batteryVoltage = raw / 100;
    }

    if (attributeId === 0x6a && value.length >= 1) {
      // En los paquetes reales este valor llega como 0x17/0x18.
      // Lo dejamos como CSQ, porque coincide con rango de señal GSM.
      result.csq = value.readUInt8(0);
    }

    if (attributeId === 0x6b && value.length >= 1) {
      result.satellites = value.readUInt8(0);
    }

    if (attributeId === 0x8b && value.length >= 1) {
      const raw =
        value.length >= 2 ? value.readUInt16BE(0) : value.readUInt8(0);

      result.batteryLevel = normalizeBatteryPercent(raw);
    }

    // Atributo 0x64 suele venir asociado a WiFi MAC en el SDK.
    if (attributeId === 0x64 && value.length > 0) {
      result.hasWifi = true;
    }

    offset += length;
  }

  return result;
}

export function parseHHDPacket(raw: Buffer): HHDPacket | null {
  try {
    if (raw.length < 15) return null;
    if (raw[0] !== 0x7e || raw[raw.length - 1] !== 0x7e) return null;

    const content = raw.slice(1, raw.length - 1);
    const unescaped = unescapeBuffer(content);

    if (unescaped.length < 13) return null;

    const packetWithoutChecksum = unescaped.slice(0, unescaped.length - 1);
    const receivedChecksum = unescaped[unescaped.length - 1];
    const calculatedChecksum = checksum(packetWithoutChecksum);

    if (receivedChecksum !== calculatedChecksum) {
      console.warn(
        `Checksum distinto recibido=${receivedChecksum.toString(
          16,
        )} calculado=${calculatedChecksum.toString(16)}`,
      );
    }

    const msgId = packetWithoutChecksum.readUInt16BE(0);
    const msgAttr = packetWithoutChecksum.readUInt16BE(2);
    const msgLength = msgAttr & 0x03ff;

    if (packetWithoutChecksum.length < 12 + msgLength) return null;

    const terminalId = packetWithoutChecksum
      .slice(4, 10)
      .toString('hex')
      .toUpperCase();

    const serialNumber = packetWithoutChecksum.readUInt16BE(10);
    const body = packetWithoutChecksum.slice(12, 12 + msgLength);

    return {
      msgId,
      msgLength,
      terminalId,
      serialNumber,
      body,
    };
  } catch {
    return null;
  }
}

export function parseHHDPosition(body: Buffer): HHDPosition | null {
  try {
    if (body.length < 28) return null;

    const alarmFlag = body.readUInt32BE(0);
    const status = body.readUInt32BE(4);

    const latRaw = body.readUInt32BE(8);
    const lonRaw = body.readUInt32BE(12);

    const elevation = body.readUInt16BE(16);
    const speed = body.readUInt16BE(18);
    const direction = body.readUInt16BE(20);

    const timeBuffer = body.slice(22, 28);

    let latitude = decodeCoordinate(latRaw);
    let longitude = decodeCoordinate(lonRaw);

    const isSouth = ((status >> 2) & 1) === 1;
    const isWest = ((status >> 3) & 1) === 1;

    if (isSouth && latitude > 0) latitude = -latitude;
    if (isWest && longitude > 0) longitude = -longitude;

    const gpsValid = ((status >> 1) & 1) === 1;

    const coordsInRange =
      isValidCoordinate(latitude, longitude) &&
      isLikelyChileCoordinate(latitude, longitude);

    const attributes = parseHhdAttributes(body);

    let locationSource: HHDPosition['locationSource'] = 'INVALID';
    let locationStatusCode: HHDPosition['locationStatusCode'] = 0;
    let gpsPositionStatus: HHDPosition['gpsPositionStatus'] = 0;

    if (gpsValid) {
      locationSource = 'GPS';
      locationStatusCode = 1;
      gpsPositionStatus = 1;
    } else if (attributes.hasWifi) {
      locationSource = 'WIFI';
      locationStatusCode = 2;
      gpsPositionStatus = 2;
    } else if (attributes.lbsCells.length > 0) {
      locationSource = 'LBS';
      locationStatusCode = 3;
      gpsPositionStatus = 3;
    }

    const batteryLevel =
      typeof attributes.batteryLevel === 'number'
        ? attributes.batteryLevel
        : typeof attributes.batteryVoltage === 'number'
          ? Math.min(
              100,
              Math.max(
                0,
                Math.round(((attributes.batteryVoltage - 3.3) / 0.9) * 100),
              ),
            )
          : undefined;

    return {
      alarmFlag,
      status,
      latitude,
      longitude,
      elevation,
      speed: speed / 10,
      direction,
      time: `20${decodeBcd(timeBuffer[0])}-${decodeBcd(
        timeBuffer[1],
      )}-${decodeBcd(timeBuffer[2])} ${decodeBcd(
        timeBuffer[3],
      )}:${decodeBcd(timeBuffer[4])}:${decodeBcd(timeBuffer[5])}`,
      isSealed: ((status >> 14) & 1) === 1,
      isShackleClosed: ((status >> 15) & 1) === 1,
      gpsValid,
      coordsInRange,
      locationSource,
      locationStatusCode,
      gpsPositionStatus,
      lbsCells: attributes.lbsCells,
      batteryLevel,
      batteryVoltage: attributes.batteryVoltage,
      csq: attributes.csq,
      satellites: attributes.satellites,
    };
  } catch {
    return null;
  }
}

export function buildHHDResponse8001(
  terminalId: string,
  serialNumber: number,
  originalMsgId: number,
): Buffer {
  const body = Buffer.alloc(5);

  body.writeUInt16BE(serialNumber, 0);
  body.writeUInt16BE(originalMsgId, 2);
  body[4] = 0x00;

  return buildJT808Message(0x8001, terminalId, body, 0x0001);
}

export function buildEnableTrackingCommand(
  terminalId: string,
  options?: {
    timeIntervalSeconds?: number;
    heartbeatIntervalSeconds?: number;
  },
): Buffer {
  const timeIntervalSeconds = options?.timeIntervalSeconds ?? 30;
  const heartbeatIntervalSeconds = options?.heartbeatIntervalSeconds ?? 60;

  const params = [
    build0310Param('06', intTo4Bytes(timeIntervalSeconds)),
    build0310Param('08', intTo2Bytes(heartbeatIntervalSeconds)),
  ];

  const body = Buffer.concat([Buffer.from([params.length]), ...params]);

  return buildJT808Message(0x0310, terminalId, body);
}

export function buildForceGpsCommand(
  terminalId: string,
  options?: {
    timeIntervalSeconds?: number;
    heartbeatIntervalSeconds?: number;
    positionAccuracyMeters?: number;
    gnssPositionQuality?: number;
    locationStatus?: number;
  },
): Buffer {
  const timeIntervalSeconds = options?.timeIntervalSeconds ?? 30;
  const heartbeatIntervalSeconds = options?.heartbeatIntervalSeconds ?? 60;
  const positionAccuracyMeters = options?.positionAccuracyMeters ?? 10;

  // Valores experimentales basados en el SDK:
  // 2C = GNSSPositionQuality, 18 = LocationStatus, 17 = PositionAccuracy.
  const gnssPositionQuality = options?.gnssPositionQuality ?? 1;
  const locationStatus = options?.locationStatus ?? 1;

  const params = [
    build0310Param('2C', intTo1Byte(gnssPositionQuality)),
    build0310Param('18', intTo1Byte(locationStatus)),
    build0310Param('17', intTo2Bytes(positionAccuracyMeters)),
    build0310Param('06', intTo4Bytes(timeIntervalSeconds)),
    build0310Param('08', intTo2Bytes(heartbeatIntervalSeconds)),
  ];

  const body = Buffer.concat([Buffer.from([params.length]), ...params]);

  return buildJT808Message(0x0310, terminalId, body);
}

export function buildReadGpsStatusCommand(terminalId: string): Buffer {
  const parameterIds = [
    '94', // BatteryVoltage
    '97', // GPSlocationInfo
    '2C', // GNSSPositionQuality
    '18', // LocationStatus
    '17', // PositionAccuracy
    '71', // RealTimeLocStatus
    '96', // DeviceStatus
    '8B', // TerminalAlarmBatteryLevel
  ];

  const body = Buffer.concat([
    Buffer.from([0x00, parameterIds.length]),
    Buffer.from(parameterIds.join(''), 'hex'),
  ]);

  return buildJT808Message(0x0312, terminalId, body);
}

export function parseHHDParameterReport0313(body: Buffer) {
  const result: Record<string, string | number> = {};

  if (body.length < 3) {
    return result;
  }

  const flowId = body.readUInt16BE(0);
  const parameterCount = body.readUInt8(2);

  result.flowId = flowId;
  result.parameterCount = parameterCount;

  let offset = 3;

  const parameterNames: Record<number, string> = {
    0x94: 'BatteryVoltage',
    0x97: 'GPSlocationInfo',
    0x2c: 'GNSSPositionQuality',
    0x18: 'LocationStatus',
    0x17: 'PositionAccuracy',
    0x71: 'RealTimeLocStatus',
    0x96: 'DeviceStatus',
    0x8b: 'TerminalAlarmBatteryLevel',
  };

  for (let i = 0; i < parameterCount; i++) {
    if (offset + 2 > body.length) break;

    const parameterId = body.readUInt8(offset);
    const length = body.readUInt8(offset + 1);

    offset += 2;

    if (offset + length > body.length) break;

    const value = body.subarray(offset, offset + length);
    const name =
      parameterNames[parameterId] ??
      `Parameter0x${parameterId.toString(16).toUpperCase()}`;

    if (length === 1) {
      result[name] = value.readUInt8(0);
    } else if (length === 2) {
      result[name] = value.readUInt16BE(0);
    } else if (length === 4) {
      result[name] = value.readUInt32BE(0);
    } else {
      result[name] = value.toString('hex').toUpperCase();
    }

    offset += length;
  }

  return result;
}

export function buildOpenCommand(terminalId: string): Buffer {
  return Buffer.from(
    `7E03100009${terminalId.toUpperCase()}20460124060061646D696EEE7E`,
    'hex',
  );
}

export function buildCloseCommand(terminalId: string): Buffer {
  return Buffer.from(
    `7E03100009${terminalId.toUpperCase()}20460124060061646D696EEF7E`,
    'hex',
  );
}
