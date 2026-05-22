import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UsersService } from './users.service';

interface AuthReq extends Request {
  user: { id: number; email: string; role: string };
}

@Controller('users')
@UseGuards(RolesGuard)
@Roles('owner', 'admin')
export class UsersController {
  constructor(private users: UsersService) {}

  @Get()
  list() {
    return this.users.findAll();
  }

  @Post()
  create(@Body() body: { email: string; password: string; role: string; name?: string }) {
    return this.users.create(body.email, body.password, body.role, body.name);
  }

  @Patch(':id/role')
  updateRole(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { role: string },
    @Req() req: AuthReq,
  ) {
    return this.users.updateRole(id, body.role, req.user.role);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: AuthReq) {
    return this.users.remove(id, req.user.id);
  }
}
