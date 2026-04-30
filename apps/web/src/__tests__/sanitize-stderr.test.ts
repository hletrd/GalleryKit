import { describe, it, expect } from 'vitest';
import { sanitizeStderr } from '@/lib/sanitize';

describe('sanitizeStderr', () => {
    it('redacts password=VALUE pattern', () => {
        const input = "Access denied for user 'gallery'@'host' (password=secret123)";
        const result = sanitizeStderr(input);
        expect(result).toBe("Access denied for user 'gallery'@'host' (password=[REDACTED])");
    });

    it('redacts password:VALUE pattern', () => {
        const input = "Configuration error: password:my_secret_value in connection";
        const result = sanitizeStderr(input);
        expect(result).toBe("Configuration error: password:[REDACTED] in connection");
    });

    it('redacts using password: YES pattern', () => {
        const input = "Access denied for user 'gallery'@'10.0.0.1' (using password: YES)";
        const result = sanitizeStderr(input);
        expect(result).toBe("Access denied for user 'gallery'@'10.0.0.1' (using password: [REDACTED])");
    });

    it('redacts using password: NO pattern', () => {
        const input = "Access denied for user 'gallery'@'10.0.0.1' (using password: NO)";
        const result = sanitizeStderr(input);
        expect(result).toBe("Access denied for user 'gallery'@'10.0.0.1' (using password: [REDACTED])");
    });

    it('redacts PASSWORD=VALUE in uppercase (case-insensitive)', () => {
        const input = "Error: PASSWORD=topsecret";
        const result = sanitizeStderr(input);
        expect(result).toBe("Error: PASSWORD=[REDACTED]");
    });

    it('redacts Password : VALUE with mixed case and spaces', () => {
        const input = "Config: Password :  complex_value_here";
        const result = sanitizeStderr(input);
        expect(result).toBe("Config: Password :  [REDACTED]");
    });

    it('redacts the actual MYSQL_PWD value when provided', () => {
        const input = "Connection failed: gallery:myDbP@ss!@host";
        const result = sanitizeStderr(input, 'myDbP@ss!');
        expect(result).not.toContain('myDbP@ss!');
        expect(result).toContain('[REDACTED]');
    });

    it('redacts both MYSQL_PWD and password pattern in same string', () => {
        const input = "Access denied (password=myDbP@ss!) for user";
        const result = sanitizeStderr(input, 'myDbP@ss!');
        // Both the literal and the password= pattern should be redacted
        expect(result).not.toContain('myDbP@ss!');
        expect(result).toContain('[REDACTED]');
    });

    it('does not modify unrelated text', () => {
        const input = "Warning: Using a password on the command line interface can be insecure.";
        const result = sanitizeStderr(input);
        // "password" appears but not followed by = or : in a credential pattern
        // The "using password:" regex does not match because the colon is not
        // immediately after "password" — "password on" doesn't match "using password:\s*\S+"
        // and "password on" doesn't match "password\s*[:=]"
        expect(result).toBe("Warning: Using a password on the command line interface can be insecure.");
    });

    it('handles empty input', () => {
        expect(sanitizeStderr('')).toBe('');
    });

    it('handles Buffer input', () => {
        const input = Buffer.from("Error: password=testval in config");
        const result = sanitizeStderr(input);
        expect(result).toBe("Error: password=[REDACTED] in config");
    });

    it('redacts password value with special regex characters in pwd', () => {
        const input = "Connection string: myP@ss$word extra";
        const result = sanitizeStderr(input, 'myP@ss$word');
        expect(result).not.toContain('myP@ss$word');
        expect(result).toContain('[REDACTED]');
    });

    it('stops password value redaction at semicolon', () => {
        const input = "password=secret;host=localhost";
        const result = sanitizeStderr(input);
        expect(result).toBe("password=[REDACTED];host=localhost");
    });

    it('stops password value redaction at single quote', () => {
        const input = "password=secret'user";
        const result = sanitizeStderr(input);
        expect(result).toBe("password=[REDACTED]'user");
    });
});
