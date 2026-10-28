import { describe, expect, it } from 'vitest'
import { createInMemoryRepositories } from '../inMemoryRepositories.js'

describe('in-memory repositories schema contract', () => {
  it('enforces unique constraints on username, apiKey, and shortUrl with PostgreSQL 23505 code', async () => {
    const { usersRepository, linksRepository } = createInMemoryRepositories()

    await usersRepository.createUser({
      username: 'first_user',
      passwordHash: 'hash',
      email: 'first@example.com',
      createdIp: '127.0.0.1',
      role: 'user',
      isActive: true,
      apiKey: 'unique-key-1',
      apiActive: true,
      apiQuota: 60,
    })

    await expect(
      usersRepository.createUser({
        username: 'first_user',
        passwordHash: 'hash',
        email: null,
        createdIp: '127.0.0.1',
        role: 'user',
        isActive: true,
        apiKey: null,
        apiActive: false,
        apiQuota: 60,
      }),
    ).rejects.toMatchObject({ code: '23505' })

    await expect(
      usersRepository.createUser({
        username: 'second_user',
        passwordHash: 'hash',
        email: null,
        createdIp: '127.0.0.1',
        role: 'user',
        isActive: true,
        apiKey: 'unique-key-1',
        apiActive: true,
        apiQuota: 60,
      }),
    ).rejects.toMatchObject({ code: '23505' })

    await linksRepository.createLink({
      shortUrl: 'dup-slug',
      longUrl: 'https://example.com/1',
      createdIp: '127.0.0.1',
      creatorId: 1,
      secretKey: null,
      isCustom: true,
      isApi: false,
    })

    await expect(
      linksRepository.createLink({
        shortUrl: 'dup-slug',
        longUrl: 'https://example.com/2',
        createdIp: '127.0.0.1',
        creatorId: 1,
        secretKey: null,
        isCustom: true,
        isApi: false,
      }),
    ).rejects.toMatchObject({ code: '23505' })
  })

  it('nullifies links.creatorId and creatorUsername when the owning user is deleted (ON DELETE SET NULL)', async () => {
    const { state, usersRepository, linksRepository } = createInMemoryRepositories()
    const createdUser = await usersRepository.createUser({
      username: 'transient_user',
      passwordHash: 'hash',
      email: null,
      createdIp: '127.0.0.1',
      role: 'user',
      isActive: true,
      apiKey: null,
      apiActive: false,
      apiQuota: 60,
    })

    await linksRepository.createLink({
      shortUrl: 'owned1',
      longUrl: 'https://example.com/owned',
      createdIp: '127.0.0.1',
      creatorId: createdUser.id,
      secretKey: null,
      isCustom: false,
      isApi: false,
    })

    expect(state.links[0]?.creatorId).toBe(createdUser.id)
    expect(state.links[0]?.creatorUsername).toBe('transient_user')

    await usersRepository.deleteUser(createdUser.id)
    expect(state.links[0]?.creatorId).toBeNull()
    expect(state.links[0]?.creatorUsername).toBeNull()
  })

  it('sorts DataTables user and link queries according to orderColumnIndex and orderDirection', async () => {
    const { usersRepository, linksRepository } = createInMemoryRepositories({
      users: [
        {
          id: 1,
          username: 'charlie',
          passwordHash: null,
          email: 'c@example.com',
          createdIp: null,
          role: 'user',
          isActive: true,
          apiKey: null,
          apiActive: false,
          apiQuota: 60,
          createdAt: new Date('2021-01-01T00:00:00Z'),
          updatedAt: new Date('2021-01-01T00:00:00Z'),
        },
        {
          id: 2,
          username: 'alice',
          passwordHash: null,
          email: 'a@example.com',
          createdIp: null,
          role: 'admin',
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
          id: 1,
          shortUrl: 'b-link',
          longUrl: 'https://example.com/b',
          createdIp: '127.0.0.1',
          creatorId: 1,
          creatorUsername: 'charlie',
          clicks: 10,
          secretKey: null,
          isDisabled: false,
          isCustom: false,
          isApi: false,
          createdAt: new Date('2021-01-01T00:00:00Z'),
          updatedAt: new Date('2021-01-01T00:00:00Z'),
        },
        {
          id: 2,
          shortUrl: 'a-link',
          longUrl: 'https://example.com/a',
          createdIp: '127.0.0.1',
          creatorId: 2,
          creatorUsername: 'alice',
          clicks: 50,
          secretKey: null,
          isDisabled: false,
          isCustom: false,
          isApi: false,
          createdAt: new Date('2022-01-01T00:00:00Z'),
          updatedAt: new Date('2022-01-01T00:00:00Z'),
        },
      ],
    })

    const usersAsc = await usersRepository.paginateAdminUsers({
      draw: 1,
      start: 0,
      length: 10,
      searchValue: '',
      orderColumnIndex: 0,
      orderDirection: 'asc',
    })
    expect(usersAsc.data.map(u => u.username)).toEqual(['alice', 'charlie'])

    const linksByClicksDesc = await linksRepository.paginateAdminLinks({
      draw: 1,
      start: 0,
      length: 10,
      searchValue: '',
      orderColumnIndex: 2,
      orderDirection: 'desc',
    })
    expect(linksByClicksDesc.data.map(l => l.shortUrl)).toEqual(['a-link', 'b-link'])
  })
})
