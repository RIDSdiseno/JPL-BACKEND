import { Module } from '@nestjs/common';
import { PrismaModule } from '../../config/prisma/prisma.module';
import { TcpModule } from '../tcp/tcp.module';
import { ControlController } from './control.controller';
import { ControlService } from './control.service';

@Module({
  imports: [PrismaModule, TcpModule],
  controllers: [ControlController],
  providers: [ControlService],
})
export class ControlModule {}
