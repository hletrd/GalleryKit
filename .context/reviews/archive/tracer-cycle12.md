# Tracer - Cycle 12

Causal tracing of:
1. `createAdminUser` duplicate-username path (end-to-end)
2. `createAdminUser` generic-error path
3. `updatePassword` typo path (form-field validation ordering)

## Trace 1: duplicate-username

```
createAdminUser(formData)
 -> isAdmin() OK
 -> requireSameOriginAdmin() OK
 -> getRestoreMaintenanceMessage() OK
 -> sanitize+validate(username, password, confirmPassword)  [VALIDATION, no RL increment]
 -> checkUserCreateRateLimit(ip)                            [MAP PRE-INCREMENT]
 -> incrementRateLimit(ip, 'user_create', ...)              [DB PRE-INCREMENT]
 -> db.insert(adminUsers)                                    [FAILS with ER_DUP_ENTRY]
 -> catch (e: unknown)
    -> hasMySQLErrorCode(e, 'ER_DUP_ENTRY') == true
    -> resetRateLimit(ip, 'user_create', ...)               [DB ROLLBACK]  OK
    -> resetUserCreateRateLimit(ip)                          [MAP ROLLBACK] OK
    -> return { error: usernameExists }                     [CLEAN]
```

Result: no counter leak. Verified.

## Trace 2: generic error (e.g. DB connection drop mid-insert)

```
... same as Trace 1 up through db.insert(adminUsers) ...
 -> db.insert(adminUsers)                                   [FAILS with unknown error]
 -> catch (e: unknown)
    -> hasMySQLErrorCode(e, 'ER_DUP_ENTRY') == false
    -> console.error(...)
    -> resetRateLimit(ip, 'user_create', ...)               [DB ROLLBACK]  OK
    -> resetUserCreateRateLimit(ip)                          [MAP ROLLBACK] OK
    -> return { error: failedToCreateUser }                 [CLEAN]
```

Result: no counter leak. Verified.

## Trace 3: updatePassword typo

```
updatePassword(prevState, formData)
 -> getCurrentUser() OK
 -> getRestoreMaintenanceMessage() OK
 -> hasTrustedSameOrigin(requestHeaders) OK
 -> sanitize+validate(current, new, confirm)
    -> validation fails (e.g. passwords mismatch)
    -> return { error: ... }                               [NO RL INCREMENT]  OK
```

Result: typos don't consume rate-limit slots. Verified.

## Confidence: High
