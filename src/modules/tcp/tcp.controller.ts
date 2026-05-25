import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HHDCommandService } from './commands/hhd-command.service';
import { TcpDeviceRegistryService } from './registry/tcp-device-registry.service';

@Controller('tcp')
@UseGuards(JwtAuthGuard)
export class TcpController {
  constructor(
    private readonly registry: TcpDeviceRegistryService,
    private readonly commandService: HHDCommandService,
  ) {}

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

  @Get('packets')
  getPackets() {
    return {
      ok: true,
      data: this.registry.getPackets(200),
    };
  }

  @Post('devices/:terminalId/open')
  openLock(
    @Param('terminalId') terminalId: string,
    @Body() body?: { operatorName?: string },
  ) {
    return {
      ok: true,
      data: this.commandService.openLock(
        terminalId,
        body?.operatorName ?? 'admin',
      ),
    };
  }

  @Post('devices/:terminalId/close')
  closeLock(
    @Param('terminalId') terminalId: string,
    @Body() body?: { operatorName?: string },
  ) {
    return {
      ok: true,
      data: this.commandService.closeLock(
        terminalId,
        body?.operatorName ?? 'admin',
      ),
    };
  }
}
