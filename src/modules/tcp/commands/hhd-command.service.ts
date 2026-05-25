import { Injectable } from '@nestjs/common';
import { buildSealCommand } from '../protocols/hhd-protocol';
import { TcpDeviceRegistryService } from '../registry/tcp-device-registry.service';

@Injectable()
export class HHDCommandService {
  constructor(private readonly registry: TcpDeviceRegistryService) {}

  sendSealCommand(terminalId: string, seal: boolean, operatorName = 'admin') {
    const serialNumber = Math.floor(Math.random() * 65535);

    const command = buildSealCommand(
      terminalId,
      serialNumber,
      seal,
      operatorName,
    );

    const device = this.registry.getDeviceByTerminalId(terminalId);

    if (device) {
      device.socket.write(command);
    } else {
      this.registry.queueCommand(terminalId, command);
    }

    return {
      terminalId,
      action: seal ? 'SEAL' : 'UNSEAL',
      deviceOnline: Boolean(device),
      queued: !device,
      hexSent: command.toString('hex').toUpperCase(),
      sentAt: new Date(),
    };
  }

  openLock(terminalId: string, operatorName = 'admin') {
    return this.sendSealCommand(terminalId, false, operatorName);
  }

  closeLock(terminalId: string, operatorName = 'admin') {
    return this.sendSealCommand(terminalId, true, operatorName);
  }
}
