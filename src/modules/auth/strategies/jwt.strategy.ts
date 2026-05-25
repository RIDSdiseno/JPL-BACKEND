import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../config/prisma/prisma.service';

type JwtPayload = {
  sub: string;
  email: string;
  username: string;
  roleId: string | null;
  companyId: string | null;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const secret = configService.get<string>('JWT_SECRET');

    if (!secret) {
      throw new Error('JWT_SECRET no está definido en .env');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.prisma.user.findFirst({
      where: {
        id: payload.sub,
        isDeleted: false,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Token inválido');
    }

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      name: user.name,
      roleId: user.roleId,
      companyId: user.companyId,
      status: user.status,
      accountStatus: user.accountStatus,
    };
  }
}
