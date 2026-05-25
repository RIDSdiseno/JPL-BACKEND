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
  lbsCells: HHDLbsCell[];
  batteryLevel?: number;
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
  for (const byte of buffer) value ^= byte;
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
  const normalizedTerminalId = terminalId.toUpperCase();

  if (!/^[0-9A-F]{12}$/.test(normalizedTerminalId)) {
    throw new Error(
      `terminalId inválido para JT808. Debe tener 12 caracteres HEX: ${terminalId}`,
    );
  }

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

function parseHhdAttributes(body: Buffer) {
  const result: {
    lbsCells: HHDLbsCell[];
    batteryLevel?: number;
    csq?: number;
    satellites?: number;
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
      result.batteryLevel = value.readUInt16BE(0);
    }

    if (attributeId === 0x6a && value.length >= 1) {
      result.csq = value.readUInt8(0);
    }

    if (attributeId === 0x6b && value.length >= 1) {
      result.satellites = value.readUInt8(0);
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

    const locationSource: HHDPosition['locationSource'] = gpsValid
      ? 'GPS'
      : attributes.lbsCells.length > 0
        ? 'LBS'
        : 'INVALID';

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
      lbsCells: attributes.lbsCells,
      batteryLevel: attributes.batteryLevel,
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
