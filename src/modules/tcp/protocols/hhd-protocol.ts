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
}

function unescapeBuffer(buffer: Buffer): Buffer {
  const result: number[] = [];

  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i];

    if (byte === 0x7d) {
      i++;

      if (i >= buffer.length) break;

      const next = buffer[i];

      if (next === 0x02) {
        result.push(0x7e);
      } else if (next === 0x01) {
        result.push(0x7d);
      }
    } else {
      result.push(byte);
    }
  }

  return Buffer.from(result);
}

function escapeBuffer(buffer: Buffer): Buffer {
  const result: number[] = [];

  for (const byte of buffer) {
    if (byte === 0x7e) {
      result.push(0x7d, 0x02);
    } else if (byte === 0x7d) {
      result.push(0x7d, 0x01);
    } else {
      result.push(byte);
    }
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

function decodeCoordinate(raw: number): number {
  const option1 = raw / 1_000_000;
  const option2 = raw / 10_000_000;

  if (option1 >= -90 && option1 <= 90) {
    return option1;
  }

  return option2;
}

function decodeBcd(value: number): string {
  return value.toString(16).padStart(2, '0');
}

export function parseHHDPacket(raw: Buffer): HHDPacket | null {
  try {
    if (raw.length < 14) return null;
    if (raw[0] !== 0x7e || raw[raw.length - 1] !== 0x7e) return null;

    const content = raw.slice(1, raw.length - 1);
    const unescaped = unescapeBuffer(content);

    if (unescaped.length < 13) return null;

    const msgId = unescaped.readUInt16BE(0);
    const msgAttr = unescaped.readUInt16BE(2);
    const msgLength = msgAttr & 0x03ff;
    const terminalId = unescaped.slice(4, 10).toString('hex').toUpperCase();
    const serialNumber = unescaped.readUInt16BE(10);
    const body = unescaped.slice(12, 12 + msgLength);

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

    if (isSouth) latitude = -latitude;
    if (isWest) longitude = -longitude;

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
      gpsValid: ((status >> 1) & 1) === 1,
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
