import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { buildCloseCommand, buildOpenCommand } from './protocols/hhd-protocol';
import { TcpDeviceRegistryService } from './registry/tcp-device-registry.service';

@Controller('tcp')
@UseGuards(JwtAuthGuard)
export class TcpController {
  constructor(private readonly registry: TcpDeviceRegistryService) {}

  @Get('stats')
  getStats() {
    return {
      ok: true,
      data: this.registry.getStats(),
    };
  }

  @Get('devices')
  getDevices() {
    return {
      ok: true,
      data: this.registry.getConnectedDevices(),
    };
  }

  @Get('devices/:terminalId')
  getDevice(@Param('terminalId') terminalId: string) {
    const device = this.registry.getDeviceByTerminalId(terminalId);

    return {
      ok: true,
      data: device
        ? {
            id: device.id,
            terminalId: device.terminalId,
            ip: device.ip,
            remotePort: device.remotePort,
            connectedAt: device.connectedAt,
            lastSeen: device.lastSeen,
            packetsReceived: device.packetsReceived,
            lastPosition: device.lastPosition ?? null,
          }
        : null,
    };
  }

  @Get('packets')
  getPackets(@Query('limit') limit?: string) {
    const parsedLimit = Number(limit);

    const safeLimit =
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, 1000)
        : 200;

    return {
      ok: true,
      data: this.registry.getPackets(safeLimit),
    };
  }

  @Post('devices/:terminalId/open')
  openLock(
    @Param('terminalId') terminalId: string,
    @Body() body?: { operatorName?: string },
  ) {
    const normalizedTerminalId = terminalId.toUpperCase();
    const device = this.registry.getDeviceByTerminalId(normalizedTerminalId);
    const command = buildOpenCommand();

    if (device?.socket && !device.socket.destroyed) {
      device.socket.write(command);

      return {
        ok: true,
        data: {
          terminalId: normalizedTerminalId,
          action: 'OPEN',
          sent: true,
          queued: false,
          operatorName: body?.operatorName ?? 'admin',
          message: 'Comando ABRIR enviado por TCP',
        },
      };
    }

    this.registry.queueCommand(normalizedTerminalId, command);

    return {
      ok: true,
      data: {
        terminalId: normalizedTerminalId,
        action: 'OPEN',
        sent: false,
        queued: true,
        operatorName: body?.operatorName ?? 'admin',
        message: 'Comando ABRIR encolado hasta que el candado se conecte',
      },
    };
  }

  @Post('devices/:terminalId/close')
  closeLock(
    @Param('terminalId') terminalId: string,
    @Body() body?: { operatorName?: string },
  ) {
    const normalizedTerminalId = terminalId.toUpperCase();
    const device = this.registry.getDeviceByTerminalId(normalizedTerminalId);
    const command = buildCloseCommand();

    if (device?.socket && !device.socket.destroyed) {
      device.socket.write(command);

      return {
        ok: true,
        data: {
          terminalId: normalizedTerminalId,
          action: 'CLOSE',
          sent: true,
          queued: false,
          operatorName: body?.operatorName ?? 'admin',
          message: 'Comando CERRAR enviado por TCP',
        },
      };
    }

    this.registry.queueCommand(normalizedTerminalId, command);

    return {
      ok: true,
      data: {
        terminalId: normalizedTerminalId,
        action: 'CLOSE',
        sent: false,
        queued: true,
        operatorName: body?.operatorName ?? 'admin',
        message: 'Comando CERRAR encolado hasta que el candado se conecte',
      },
    };
  }
}
