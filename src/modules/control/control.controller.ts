import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ControlService } from './control.service';

@Controller('control')
@UseGuards(JwtAuthGuard)
export class ControlController {
  constructor(private readonly controlService: ControlService) {}

  @Get('devices')
  getDevices() {
    return this.controlService.getDevices();
  }

  @Get('nfc/:deviceId/cards')
  getNfcCards(@Param('deviceId') deviceId: string) {
    return this.controlService.getNfcCards(deviceId);
  }

  @Post('nfc/:deviceId/cards')
  addNfcCard(
    @Param('deviceId') deviceId: string,
    @Body()
    body: {
      cardNumber: string;
      createdById?: string;
    },
  ) {
    return this.controlService.addNfcCard(deviceId, body);
  }

  @Delete('nfc/:deviceId/cards/:cardId')
  removeNfcCard(
    @Param('deviceId') deviceId: string,
    @Param('cardId') cardId: string,
  ) {
    return this.controlService.removeNfcCard(deviceId, cardId);
  }

  @Post('nfc/:deviceId/auto-bind')
  startNfcAutoBind(
    @Param('deviceId') deviceId: string,
    @Body()
    body?: {
      seconds?: number;
      operatorName?: string;
    },
  ) {
    return this.controlService.startNfcAutoBind(deviceId, body);
  }

  @Post('nfc/:deviceId/ic-password')
  setIcCardPassword(
    @Param('deviceId') deviceId: string,
    @Body()
    body: {
      password: string;
      operatorName?: string;
    },
  ) {
    return this.controlService.setIcCardPassword(deviceId, body);
  }

  @Post('nfc/:deviceId/clear')
  clearIcCards(
    @Param('deviceId') deviceId: string,
    @Body()
    body?: {
      operatorName?: string;
    },
  ) {
    return this.controlService.clearIcCards(deviceId, body);
  }

  @Post('password/:deviceId/set')
  setPassword(
    @Param('deviceId') deviceId: string,
    @Body() body: { password: string; operatorName?: string },
  ) {
    return this.controlService.setPassword(deviceId, body);
  }

  @Get('cmd-log')
  getCommandLog(
    @Query('deviceId') deviceId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('status') status?: string,
  ) {
    return this.controlService.getCommandLog({
      deviceId,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
      status,
    });
  }

  @Post('preconfig/:deviceId/apply')
  applyPreset(
    @Param('deviceId') deviceId: string,
    @Body()
    body: {
      preset:
        | 'tracking_fast'
        | 'tracking_normal'
        | 'tracking_slow'
        | 'gps_force';
      operatorName?: string;
    },
  ) {
    return this.controlService.applyPreset(
      deviceId,
      body.preset,
      body.operatorName,
    );
  }

  @Get('parameters/:deviceId/snapshots')
  getParameterSnapshots(@Param('deviceId') deviceId: string) {
    return this.controlService.getParameterSnapshots(deviceId);
  }
}
