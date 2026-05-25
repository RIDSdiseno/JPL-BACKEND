import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../config/prisma/prisma.service';
import { LoginDto } from './dto/login.dto';

type RecaptchaVerifyResponse = {
  success: boolean;
  challenge_ts?: string;
  hostname?: string;
  'error-codes'?: string[];
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  private async verifyRecaptcha(token: string): Promise<void> {
    const secret = this.configService.get<string>('RECAPTCHA_SECRET_KEY');

    if (!secret) {
      throw new UnauthorizedException('reCAPTCHA no configurado');
    }

    const params = new URLSearchParams({
      secret,
      response: token,
    });

    const response = await fetch(
      'https://www.google.com/recaptcha/api/siteverify',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params,
      },
    );

    const data = (await response.json()) as RecaptchaVerifyResponse;

    if (!data.success) {
      throw new UnauthorizedException('Captcha inválido');
    }
  }

  async login(dto: LoginDto) {
    await this.verifyRecaptcha(dto.recaptchaToken);

    const user = await this.prisma.user.findFirst({
      where: {
        isDeleted: false,
        OR: [{ username: dto.username }, { email: dto.username }],
      },
    });

    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const isValidPassword = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );

    if (!isValidPassword) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const payload = {
      sub: user.id,
      username: user.username ?? user.email,
      email: user.email,
      roleId: user.roleId,
      companyId: user.companyId,
    };

    const accessToken = await this.jwtService.signAsync(payload);

    return {
      ok: true,
      message: 'Login exitoso',
      data: {
        accessToken,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          name: user.name,
          status: user.status,
          accountStatus: user.accountStatus,
          roleId: user.roleId,
          companyId: user.companyId,
          forceChangePassword: user.forceChangePassword,
        },
      },
    };
  }
}
