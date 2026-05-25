import { Module } from '@nestjs/common';
import { PrismaModule } from '../../config/prisma/prisma.module';
import { TcpController } from './tcp.controller';
import { TcpGateway } from './tcp.gateway';
import { TcpDeviceRegistryService } from './registry/tcp-device-registry.service';
import { LbsGeolocationService } from './services/lbs-geolocation.service';

@Module({
  imports: [PrismaModule],
  controllers: [TcpController],
  providers: [TcpGateway, TcpDeviceRegistryService, LbsGeolocationService],
  exports: [TcpDeviceRegistryService, LbsGeolocationService],
})
export class TcpModule {}
