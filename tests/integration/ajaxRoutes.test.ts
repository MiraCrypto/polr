import { describe, expect, it } from 'vitest'
import { createApplication } from '../../src/app.js'
import { hashPasswordWithBcrypt } from '../../src/domain/authService.js'
import { authenticateSession, TEST_CONFIGURATION } from '../helpers.js'
import { createInMemoryRepositories } from '../inMemoryRepositories.js'

describe('frontend AJAX endpoints, DataTables wire contracts, and RBAC matrix', () => {
  it('enforces RBAC, self-reset API key permissions, and exact wire return values for AdminCtrl.js', async () => {
    const adminHash = await hashPasswordWithBcrypt('admin-pw')
    const devHash = await hashPasswordWithBcrypt('dev-pw')
    const basicHash = await hashPasswordWithBcrypt('basic-pw')

    const { state, usersRepository, linksRepository } = createInMemoryRepositories({
      users: [
        {
          id: 1,
          username: 'admin_user',
          passwordHash: adminHash,
          email: 'admin@example.com',
          createdIp: '127.0.0.1',
          role: 'admin',
          isActive: true,
          apiKey: 'admin-key',
          apiActive: true,
          apiQuota: 60,
          createdAt: new Date('2020-01-01T00:00:00Z'),
          updatedAt: new Date('2020-01-01T00:00:00Z'),
        },
        {
          id: 2,
          username: 'dev_user',
          passwordHash: devHash,
          email: 'dev@example.com',
          createdIp: '127.0.0.1',
          role: 'user',
          isActive: true,
          apiKey: 'initial-dev-key',
          apiActive: true,
          apiQuota: 30,
          createdAt: new Date('2021-01-01T00:00:00Z'),
          updatedAt: new Date('2021-01-01T00:00:00Z'),
        },
        {
          id: 3,
          username: 'basic_user',
          passwordHash: basicHash,
          email: 'basic@example.com',
          createdIp: '127.0.0.1',
          role: 'user',
          isActive: true,
          apiKey: null,
          apiActive: false,
          apiQuota: 60,
          createdAt: new Date('2022-01-01T00:00:00Z'),
          updatedAt: new Date('2022-01-01T00:00:00Z'),
        },
      ],
      links: [
        {
          id: 100,
          shortUrl: 'dev-link',
          longUrl: 'https://example.com/dev-owned',
          createdIp: '127.0.0.1',
          creatorId: 2,
          creatorUsername: 'dev_user',
          clicks: 12,
          secretKey: null,
          isDisabled: false,
          isCustom: true,
          isApi: false,
          createdAt: new Date('2021-06-01T00:00:00Z'),
          updatedAt: new Date('2021-06-01T00:00:00Z'),
        },
        {
          id: 101,
          shortUrl: 'admin-link',
          longUrl: 'https://example.com/admin-owned',
          createdIp: '127.0.0.1',
          creatorId: 1,
          creatorUsername: 'admin_user',
          clicks: 3,
          secretKey: null,
          isDisabled: false,
          isCustom: true,
          isApi: false,
          createdAt: new Date('2022-06-01T00:00:00Z'),
          updatedAt: new Date('2022-06-01T00:00:00Z'),
        },
      ],
    })

    const app = createApplication({
      config: TEST_CONFIGURATION,
      usersRepository,
      linksRepository,
    })

    const adminSession = await authenticateSession(app, 'admin_user', 'admin-pw')
    const devSession = await authenticateSession(app, 'dev_user', 'dev-pw')
    const basicSession = await authenticateSession(app, 'basic_user', 'basic-pw')

    const forbiddenAdminUsers = await app.request('/api/v2/admin/get_admin_users', {
      headers: { Cookie: devSession.sessionCookies },
    })
    expect(forbiddenAdminUsers.status).toBe(401)

    const forbiddenToggleApi = await app.request('/api/v2/admin/toggle_api_active', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': devSession.sessionCookies,
        'X-CSRF-TOKEN': devSession.csrfToken,
      },
      body: new URLSearchParams({ user_id: '3' }).toString(),
    })
    expect(forbiddenToggleApi.status).toBe(401)

    // Non-admin API-active users reset their own key via the #developer tab using the same endpoint
    const selfKeyReset = await app.request('/api/v2/admin/generate_new_api_key', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': devSession.sessionCookies,
        'X-CSRF-TOKEN': devSession.csrfToken,
      },
      body: new URLSearchParams({ user_id: '2' }).toString(),
    })
    expect(selfKeyReset.status).toBe(200)
    const rotatedKey = await selfKeyReset.text()
    expect(rotatedKey).toHaveLength(TEST_CONFIGURATION.apiKeyByteLength * 2)
    expect(rotatedKey).not.toBe('initial-dev-key')

    const crossUserKeyReset = await app.request('/api/v2/admin/generate_new_api_key', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': devSession.sessionCookies,
        'X-CSRF-TOKEN': devSession.csrfToken,
      },
      body: new URLSearchParams({ user_id: '1' }).toString(),
    })
    expect(crossUserKeyReset.status).toBe(401)

    const inactiveApiSelfReset = await app.request('/api/v2/admin/generate_new_api_key', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': basicSession.sessionCookies,
        'X-CSRF-TOKEN': basicSession.csrfToken,
      },
      body: new URLSearchParams({ user_id: '3' }).toString(),
    })
    expect(inactiveApiSelfReset.status).toBe(401)

    const ownLinkEdit = await app.request('/api/v2/admin/edit_link_long_url', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': devSession.sessionCookies,
        'X-CSRF-TOKEN': devSession.csrfToken,
      },
      body: new URLSearchParams({
        link_ending: 'dev-link',
        new_long_url: 'https://example.com/dev-updated',
      }).toString(),
    })
    expect(ownLinkEdit.status).toBe(200)
    expect(await ownLinkEdit.text()).toBe('OK')

    const foreignLinkEdit = await app.request('/api/v2/admin/edit_link_long_url', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': devSession.sessionCookies,
        'X-CSRF-TOKEN': devSession.csrfToken,
      },
      body: new URLSearchParams({
        link_ending: 'admin-link',
        new_long_url: 'https://example.com/hijack',
      }).toString(),
    })
    expect(foreignLinkEdit.status).toBe(401)

    const devLinksResponse = await app.request('/api/v2/admin/get_user_links?draw=2&start=0&length=10', {
      headers: { Cookie: devSession.sessionCookies },
    })
    expect(devLinksResponse.status).toBe(200)
    const devLinksPayload = (await devLinksResponse.json()) as {
      draw: number
      recordsTotal: number
      data: Array<{ short_url: string }>
    }
    expect(devLinksPayload.draw).toBe(2)
    expect(devLinksPayload.recordsTotal).toBe(1)
    expect(devLinksPayload.data[0]?.short_url).toBe('dev-link')

    const toggleUserResponse = await app.request('/api/v2/admin/toggle_user_active', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': adminSession.sessionCookies,
        'X-CSRF-TOKEN': adminSession.csrfToken,
      },
      body: new URLSearchParams({ user_id: '3' }).toString(),
    })
    expect(await toggleUserResponse.text()).toBe('0')
    expect(state.users.find(u => u.id === 3)?.isActive).toBe(false)

    const editQuotaResponse = await app.request('/api/v2/admin/edit_api_quota', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': adminSession.sessionCookies,
        'X-CSRF-TOKEN': adminSession.csrfToken,
      },
      body: new URLSearchParams({ user_id: '2', new_quota: '-1' }).toString(),
    })
    expect(await editQuotaResponse.text()).toBe('OK')
    expect(state.users.find(u => u.id === 2)?.apiQuota).toBe(-1)

    const invalidNegativeQuotaResponse = await app.request('/api/v2/admin/edit_api_quota', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': adminSession.sessionCookies,
        'X-CSRF-TOKEN': adminSession.csrfToken,
      },
      body: new URLSearchParams({ user_id: '2', new_quota: '-50' }).toString(),
    })
    expect(invalidNegativeQuotaResponse.status).toBe(400)
    expect(state.users.find(u => u.id === 2)?.apiQuota).toBe(-1)

    const deleteDevUserResponse = await app.request('/api/v2/admin/delete_user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': adminSession.sessionCookies,
        'X-CSRF-TOKEN': adminSession.csrfToken,
      },
      body: new URLSearchParams({ user_id: '2' }).toString(),
    })
    expect(await deleteDevUserResponse.text()).toBe('OK')
    expect(state.links.find(l => l.shortUrl === 'dev-link')?.creatorId).toBeNull()

    const adminLinksAfterUserDelete = await app.request(
      '/api/v2/admin/get_admin_links?draw=1&start=0&length=10&order%5B0%5D%5Bcolumn%5D=2&order%5B0%5D%5Bdir%5D=desc',
      {
        headers: { Cookie: adminSession.sessionCookies },
      },
    )
    const adminLinksJson = (await adminLinksAfterUserDelete.json()) as {
      data: Array<{ short_url: string, creator: string }>
    }
    expect(adminLinksJson.data[0]?.short_url).toBe('dev-link')
    expect(adminLinksJson.data[0]?.creator).toBe('')

    const availInvalid = await app.request('/api/v2/link_avail_check', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': adminSession.sessionCookies,
      },
      body: new URLSearchParams({ link_ending: 'bad/slash', _token: adminSession.csrfToken }).toString(),
    })
    expect(availInvalid.status).toBe(200)
    expect(await availInvalid.text()).toBe('invalid')

    const availReserved = await app.request('/api/v2/link_avail_check', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': adminSession.sessionCookies,
      },
      body: new URLSearchParams({ link_ending: 'admin', _token: adminSession.csrfToken }).toString(),
    })
    expect(availReserved.status).toBe(200)
    expect(await availReserved.text()).toBe('unavailable')

    const availExisting = await app.request('/api/v2/link_avail_check', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': adminSession.sessionCookies,
      },
      body: new URLSearchParams({ link_ending: 'ADMIN-LINK', _token: adminSession.csrfToken }).toString(),
    })
    expect(await availExisting.text()).toBe('unavailable')

    const availFree = await app.request('/api/v2/link_avail_check', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': adminSession.sessionCookies,
      },
      body: new URLSearchParams({ link_ending: 'unused-slug', _token: adminSession.csrfToken }).toString(),
    })
    expect(await availFree.text()).toBe('available')

    for (const selfEndpoint of [
      '/api/v2/admin/delete_user',
      '/api/v2/admin/toggle_user_active',
      '/api/v2/admin/change_user_role',
    ]) {
      const selfResponse = await app.request(selfEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': adminSession.sessionCookies,
          'X-CSRF-TOKEN': adminSession.csrfToken,
        },
        body: new URLSearchParams({ user_id: '1', role: '' }).toString(),
      })
      expect(selfResponse.status).toBe(400)
    }

    const addNewUserResponse = await app.request('/api/v2/admin/add_new_user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': adminSession.sessionCookies,
        'X-CSRF-TOKEN': adminSession.csrfToken,
      },
      body: new URLSearchParams({
        username: 'fresh_operator',
        user_password: 'operator-password',
        user_email: 'operator@example.com',
        user_role: 'admin',
      }).toString(),
    })
    expect(addNewUserResponse.status).toBe(200)
    expect(await addNewUserResponse.text()).toBe('OK')

    const duplicateNewUserResponse = await app.request('/api/v2/admin/add_new_user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': adminSession.sessionCookies,
        'X-CSRF-TOKEN': adminSession.csrfToken,
      },
      body: new URLSearchParams({
        username: 'fresh_operator',
        user_password: 'operator-password',
        user_email: 'operator@example.com',
        user_role: 'admin',
      }).toString(),
    })
    expect(duplicateNewUserResponse.status).toBe(409)

    // AdminCtrl.js binds the toggle_link response directly to the button label (the next action to take)
    const disableLinkResponse = await app.request('/api/v2/admin/toggle_link', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': adminSession.sessionCookies,
        'X-CSRF-TOKEN': adminSession.csrfToken,
      },
      body: new URLSearchParams({ link_ending: 'admin-link' }).toString(),
    })
    expect(await disableLinkResponse.text()).toBe('Enable')

    const disabledPageResponse = await app.request('/admin-link')
    expect(disabledPageResponse.status).toBe(200)
    expect(await disabledPageResponse.text()).toContain(
      'Sorry, but this link has been disabled by an administrator.',
    )

    const enableLinkResponse = await app.request('/api/v2/admin/toggle_link', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': adminSession.sessionCookies,
        'X-CSRF-TOKEN': adminSession.csrfToken,
      },
      body: new URLSearchParams({ link_ending: 'admin-link' }).toString(),
    })
    expect(await enableLinkResponse.text()).toBe('Disable')

    const deleteLinkResponse = await app.request('/api/v2/admin/delete_link', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': adminSession.sessionCookies,
        'X-CSRF-TOKEN': adminSession.csrfToken,
      },
      body: new URLSearchParams({ link_ending: 'admin-link' }).toString(),
    })
    expect(await deleteLinkResponse.text()).toBe('OK')
  })
})
