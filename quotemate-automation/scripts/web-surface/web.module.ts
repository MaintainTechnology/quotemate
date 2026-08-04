// Web surface module — pages, auth, sandbox. Canonical copy:
// quotemate-automation/scripts/web-surface/web.module.ts
import { Module } from '@nestjs/common'
import { WebController } from './web.controller'
import { SandboxService } from './sandbox.service'

@Module({ controllers: [WebController], providers: [SandboxService] })
export class WebModule {}
