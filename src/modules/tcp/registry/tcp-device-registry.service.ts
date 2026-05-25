import { Injectable } from '@nestjs/common';
import type { Socket } from 'net';

export interface TcpDeviceConnection {
  id: string;
  terminalId: string;
  socket: Socket;
  ip: string;
  remotePort?: number;
  connectedAt: Date;
  lastSeen: Date;
  packetsReceived: number;
}

export interface ReceivedTcpPacket {
  id: number;
  socketId: string;
  terminalId: string;
  ip: string;
  remotePort?: number;
  size: number;
  hex: string;
  receivedAt: Date;
}

@Injectable()
export class TcpDeviceRegistryService {
  private readonly connectedDevices = new Map<string, TcpDeviceConnection>();
  private readonly devicesByTerminalId = new Map<string, TcpDeviceConnection>();
  private readonly pendingCommands = new Map<string, Buffer[]>();
  private readonly packets: ReceivedTcpPacket[] = [];

  private packetCounter = 1;
  private totalConnections = 0;
  private totalPackets = 0;

  addConnection(connection: TcpDeviceConnection): void {
    this.totalConnections += 1;
    this.connectedDevices.set(connection.id, connection);
  }

  removeConnection(socketId: string): void {
    const connection = this.connectedDevices.get(socketId);

    if (connection?.terminalId) {
      this.devicesByTerminalId.delete(connection.terminalId);
    }

    this.connectedDevices.delete(socketId);
  }

  touch(socketId: string): void {
    const connection = this.connectedDevices.get(socketId);

    if (!connection) return;

    connection.lastSeen = new Date();
    connection.packetsReceived += 1;
  }

  updateTerminalId(socketId: string, terminalId: string): void {
    const connection = this.connectedDevices.get(socketId);

    if (!connection) return;

    const normalizedTerminalId = terminalId.toUpperCase();

    connection.terminalId = normalizedTerminalId;
    connection.lastSeen = new Date();

    this.devicesByTerminalId.set(normalizedTerminalId, connection);
  }

  getDeviceByTerminalId(terminalId: string): TcpDeviceConnection | undefined {
    return this.devicesByTerminalId.get(terminalId.toUpperCase());
  }

  queueCommand(terminalId: string, command: Buffer): void {
    const normalizedTerminalId = terminalId.toUpperCase();
    const existing = this.pendingCommands.get(normalizedTerminalId) ?? [];

    existing.push(command);
    this.pendingCommands.set(normalizedTerminalId, existing);
  }

  consumePendingCommands(terminalId: string): Buffer[] {
    const normalizedTerminalId = terminalId.toUpperCase();
    const commands = this.pendingCommands.get(normalizedTerminalId) ?? [];

    this.pendingCommands.delete(normalizedTerminalId);

    return commands;
  }

  addPacket(packet: Omit<ReceivedTcpPacket, 'id'>): void {
    this.totalPackets += 1;

    this.packets.unshift({
      id: this.packetCounter,
      ...packet,
    });

    this.packetCounter += 1;

    if (this.packets.length > 1000) {
      this.packets.pop();
    }
  }

  getConnectedDevices() {
    return Array.from(this.connectedDevices.values()).map((device) => ({
      id: device.id,
      terminalId: device.terminalId,
      ip: device.ip,
      remotePort: device.remotePort,
      connectedAt: device.connectedAt,
      lastSeen: device.lastSeen,
      packetsReceived: device.packetsReceived,
    }));
  }

  getPackets(limit = 100) {
    return this.packets.slice(0, limit);
  }

  getStats() {
    return {
      connectedDevices: this.connectedDevices.size,
      connectedByTerminalId: this.devicesByTerminalId.size,
      pendingCommands: this.pendingCommands.size,
      totalConnections: this.totalConnections,
      totalPackets: this.totalPackets,
      storedPackets: this.packets.length,
      uptimeSeconds: process.uptime(),
      memory: process.memoryUsage(),
    };
  }
}
