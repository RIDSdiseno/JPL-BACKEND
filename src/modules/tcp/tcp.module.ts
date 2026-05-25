import { Module } from '@nestjs/common';
import { PrismaModule } from '../../config/prisma/prisma.module';
import { TcpController } from './tcp.controller';
import { TcpGateway } from './tcp.gateway';
import { TcpDeviceRegistryService } from './registry/tcp-device-registry.service';

@Module({
  imports: [PrismaModule],
  controllers: [TcpController],
  providers: [TcpGateway, TcpDeviceRegistryService],
  exports: [TcpDeviceRegistryService],
})
export class TcpModule {}
