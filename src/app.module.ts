import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './config/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { ControlModule } from './modules/control/control.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { MonitoringModule } from './modules/monitoring/monitoring.module';
import { TcpModule } from './modules/tcp/tcp.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    AuthModule,
    DashboardModule,
    MonitoringModule,
    TcpModule,
    ControlModule,
  ],
})
export class AppModule {}
