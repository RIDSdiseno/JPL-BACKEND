import { Module } from '@nestjs/common';
import { PrismaModule } from '../../config/prisma/prisma.module';
import { HHDCommandService } from './commands/hhd-command.service';
import { TcpController } from './tcp.controller';
import { TcpGateway } from './tcp.gateway';
import { TcpDeviceRegistryService } from './registry/tcp-device-registry.service';

@Module({
  imports: [PrismaModule],
  controllers: [TcpController],
  providers: [TcpGateway, TcpDeviceRegistryService, HHDCommandService],
  exports: [TcpDeviceRegistryService, HHDCommandService],
})
export class TcpModule {}
