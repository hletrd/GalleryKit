import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const nginxConfig = readFileSync(resolve(__dirname, '..', '..', 'nginx', 'default.conf'), 'utf8');
const composeConfig = readFileSync(resolve(__dirname, '..', '..', 'docker-compose.yml'), 'utf8');
const dockerfile = readFileSync(resolve(__dirname, '..', '..', 'Dockerfile'), 'utf8');
const rootReadme = readFileSync(resolve(__dirname, '..', '..', '..', '..', 'README.md'), 'utf8');
const webReadme = readFileSync(resolve(__dirname, '..', '..', 'README.md'), 'utf8');
const envExample = readFileSync(resolve(__dirname, '..', '..', '.env.local.example'), 'utf8');

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
        expect(nginxConfig).toMatch(/location \^~ \/api\/admin\/lr\/upload \{[\s\S]*client_max_body_size 216M;/);
        expect(nginxConfig.indexOf('location ^~ /api/admin/lr/upload')).toBeLessThan(nginxConfig.indexOf('location ^~ /api/admin/ {'));
    });

    it('rate-limits settings, SEO, and admin API mutation surfaces', () => {
        expect(nginxConfig).toContain('/admin/(categories|tags|users|password|seo|settings|tokens)');
        expect(nginxConfig).toMatch(/location \^~ \/api\/admin\/ \{[\s\S]*limit_req zone=admin/);
    });

    it('overwrites forwarded client IP headers at the shipped nginx edge', () => {
        expect(nginxConfig).not.toContain('proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;');
        const forwardedForHeaders = nginxConfig.match(/proxy_set_header X-Forwarded-For \$remote_addr;/g) ?? [];
        expect(forwardedForHeaders.length).toBeGreaterThanOrEqual(5);
    });

    it('documents the checked-in nginx template as the forwarded-chain normalizer', () => {
        for (const source of [rootReadme, webReadme, envExample]) {
            expect(source).toMatch(/overwrites incoming[\s#`]+X-Forwarded-For`?/);
            expect(source).toContain('X-Forwarded-For');
            expect(source).toContain('TRUSTED_PROXY_HOPS=1');
        }
    });

    it('overwrites forwarded host on every proxied location and documents TLS edge ownership', () => {
        expect(nginxConfig).toContain('Do not expose');
        expect(nginxConfig).toContain('public cleartext edge');
        const proxyPasses = nginxConfig.match(/proxy_pass http:\/\/nextjs;/g) ?? [];
        const forwardedHostHeaders = nginxConfig.match(/proxy_set_header X-Forwarded-Host \$host;/g) ?? [];
        expect(forwardedHostHeaders.length).toBe(proxyPasses.length);
    });

    it('proxies uploads instead of rooting host-side nginx at the container path', () => {
        const uploadsLocation = nginxConfig.match(/location ~ \^\(\?:\/\[a-z\]\{2\}\)\?\/uploads\/\(jpeg\|webp\|avif\)[\s\S]*?\n    \}/)?.[0] ?? '';
        expect(uploadsLocation).toContain('proxy_pass http://nextjs;');
        expect(uploadsLocation).not.toContain('root /app/apps/web/public;');
    });

    it('binds the standalone server to loopback in Dockerfile and compose', () => {
        expect(dockerfile).toContain('ENV HOSTNAME="127.0.0.1"');
        expect(composeConfig).toContain('HOSTNAME: 127.0.0.1');
    });

    it('mounts only mutable public subdirectories so built assets come from the image', () => {
        expect(composeConfig).toContain('./public/uploads:/app/apps/web/public/uploads');
        expect(composeConfig).toContain('./public/resources:/app/apps/web/public/resources');
        expect(composeConfig).not.toContain('./public:/app/apps/web/public');
    });
});
