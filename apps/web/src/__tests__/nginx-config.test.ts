import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const nginxConfig = readFileSync(resolve(__dirname, '..', '..', 'nginx', 'default.conf'), 'utf8');

describe('nginx production edge hardening', () => {
    it('preserves trusted forwarded proto instead of overwriting it with the local scheme', () => {
        expect(nginxConfig).toContain('map $http_x_forwarded_proto $gallerykit_forwarded_proto');
        expect(nginxConfig).toContain('proxy_set_header X-Forwarded-Proto $gallerykit_forwarded_proto;');
        expect(nginxConfig).not.toContain('proxy_set_header X-Forwarded-Proto $scheme;');
    });

    it('uses narrow default/admin body limits and explicit upload/restore exceptions', () => {
        expect(nginxConfig).toMatch(/server \{[\s\S]*client_max_body_size 2M;/);
        expect(nginxConfig).toMatch(/location ~ \^\(\/\[a-z\]\{2\}\)\?\/admin\$ \{[\s\S]*client_max_body_size 64K;/);
        expect(nginxConfig).toMatch(/location ~ \^\(\/\[a-z\]\{2\}\)\?\/admin\/db \{[\s\S]*client_max_body_size 250M;/);
        expect(nginxConfig).toMatch(/location ~ \^\(\/\[a-z\]\{2\}\)\?\/admin\/dashboard \{[\s\S]*client_max_body_size 216M;/);
    });

    it('rate-limits settings, SEO, and admin API mutation surfaces', () => {
        expect(nginxConfig).toContain('/admin/(categories|tags|users|password|seo|settings)');
        expect(nginxConfig).toMatch(/location \^~ \/api\/admin\/ \{[\s\S]*limit_req zone=admin/);
    });

    it('overwrites inbound X-Forwarded-For instead of appending spoofable client values', () => {
        expect(nginxConfig).not.toContain('$proxy_add_x_forwarded_for');
        const forwardedForHeaders = nginxConfig.match(/proxy_set_header X-Forwarded-For \$remote_addr;/g) ?? [];
        expect(forwardedForHeaders.length).toBeGreaterThanOrEqual(5);
    });
});
