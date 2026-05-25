export interface HHDPacket {
  msgId: number;
  msgLength: number;
  terminalId: string;
  serialNumber: number;
  body: Buffer;
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

function decodeCoordinate(raw: number, type: 'lat' | 'lng'): number {
  const primary = raw / 1_000_000;

  if (type === 'lat' && primary >= 0 && primary <= 90) return primary;
  if (type === 'lng' && primary >= 0 && primary <= 180) return primary;

  return raw / 10_000_000;
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

    if (receivedChecksum !== calculatedChecksum) return null;

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

    let latitude = decodeCoordinate(latRaw, 'lat');
    let longitude = decodeCoordinate(lonRaw, 'lng');

    const isSouth = ((status >> 2) & 1) === 1;
    const isWest = ((status >> 3) & 1) === 1;

    if (isSouth && latitude > 0) latitude = -latitude;
    if (isWest && longitude > 0) longitude = -longitude;

    const gpsValid = ((status >> 1) & 1) === 1;

    const coordsInRange =
      isValidCoordinate(latitude, longitude) &&
      isLikelyChileCoordinate(latitude, longitude);

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

  const header = Buffer.alloc(12);

  header.writeUInt16BE(0x8001, 0);
  header.writeUInt16BE(body.length, 2);

  Buffer.from(terminalId, 'hex').copy(header, 4);

  header.writeUInt16BE(0x0001, 10);

  const packet = Buffer.concat([header, body]);
  const check = checksum(packet);

  return Buffer.concat([
    Buffer.from([0x7e]),
    escapeBuffer(packet),
    Buffer.from([check]),
    Buffer.from([0x7e]),
  ]);
}

export function buildRawHHDCommand(command: string): Buffer {
  return Buffer.from(command, 'utf8');
}

export function buildOpenCommand(): Buffer {
  return buildRawHHDCommand('UNSEAL');
}

export function buildCloseCommand(): Buffer {
  return buildRawHHDCommand('SEAL');
}
