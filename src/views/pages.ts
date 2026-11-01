import type { ApplicationConfiguration } from '../config.js'
import type { FlashMessage, UserRecord } from '../domain/types.js'
import { escapeHtmlEntities } from './dataTables.js'
import { renderBaseLayout } from './layout.js'

export interface PageRenderContext {
  readonly config: ApplicationConfiguration
  readonly csrfToken: string
  readonly currentUser: UserRecord | null
  readonly flashMessages: readonly FlashMessage[]
}

export function renderIndexPage(context: PageRenderContext): string {
  const escapedAppName = escapeHtmlEntities(context.config.appName)
  const escapedAppAddress = escapeHtmlEntities(context.config.appAddress)
  const escapedCsrfToken = escapeHtmlEntities(context.csrfToken)

  const contentHtml = `<h1 class='title'>${escapedAppName}</h1>

<form method='POST' action='/shorten' role='form'>
    <input type='url' autocomplete='off'
        class='form-control long-link-input' placeholder='http://' name='link-url' />

    <div class='row' id='options' ng-cloak>
        <p>Customize link</p>

        <div class='btn-group btn-toggle visibility-toggler' data-toggle='buttons'>
            <label class='btn btn-primary btn-sm active'>
                <input type='radio' name='options' value='p' checked /> Public
            </label>
            <label class='btn btn-sm btn-default'>
                <input type='radio' name='options' value='s' /> Secret
            </label>
        </div>

        <div>
            <div class='custom-link-text'>
                <h2 class='site-url-field'>${escapedAppAddress}/</h2>
                <input type='text' autocomplete="off" class='form-control custom-url-field' name='custom-ending' />
            </div>
            <div>
                <a href='#' class='btn btn-success btn-xs check-btn' id='check-link-availability'>Check Availability</a>
                <div id='link-availability-status'></div>
            </div>
        </div>
    </div>
    <input type='submit' class='btn btn-info' id='shorten' value='Shorten' />
    <a href='#' class='btn btn-warning' id='show-link-options'>Link Options</a>
    <input type="hidden" name='_token' value='${escapedCsrfToken}' />
</form>`

  return renderBaseLayout({
    ...context,
    extraStylesheets: ['/css/index.css'],
    extraScripts: ['/js/index.js'],
    largeJumbotron: true,
    contentHtml,
  })
}

export function renderShortenResultPage(context: PageRenderContext, shortUrl: string): string {
  const escapedShortUrl = escapeHtmlEntities(shortUrl)

  const contentHtml = `<h3>Shortened URL</h3>
<div class="input-group">
    <input type='text' class='result-box form-control' value='${escapedShortUrl}' id='short_url' />
    <div class='input-group-addon' id='clipboard-copy' data-clipboard-target='#short_url' data-toggle='tooltip' data-placement='bottom' data-title='Copied!'>
        <i class='fa fa-clipboard' aria-hidden='true' title='Copy to clipboard'></i>
    </div>
</div>
<a id="generate-qr-code" class='btn btn-primary'>Generate QR Code</a>
<a href='/' class='btn btn-info'>Shorten another</a>

<div class="qr-code-container"></div>`

  return renderBaseLayout({
    ...context,
    extraStylesheets: ['/css/shorten_result.css'],
    extraScripts: ['/js/qrcode.min.js', '/js/clipboard.min.js', '/js/shorten_result.js'],
    contentHtml,
  })
}

export function renderLoginPage(context: PageRenderContext): string {
  const escapedCsrfToken = escapeHtmlEntities(context.csrfToken)

  const contentHtml = `<div class="center-text">
    <h1>Sign In</h1><br/><br/>
    <div class="col-md-3"></div>
    <div class="col-md-6">
        <form action="/login" method="POST">
            <input type="text" placeholder="Username" name="username" class="form-control login-field" />
            <input type="password" placeholder="Password" name="password" class="form-control login-field" />
            <input type="hidden" name='_token' value='${escapedCsrfToken}' />
            <input type="submit" value="Sign In" class="login-submit btn btn-success" />
            <p class='login-prompts'></p>
        </form>
    </div>
    <div class="col-md-3"></div>
</div>`

  return renderBaseLayout({
    ...context,
    title: `Sign In - ${context.config.appName}`,
    extraStylesheets: ['/css/login.css'],
    contentHtml,
  })
}

export function renderAboutPage(context: PageRenderContext): string {
  const escapedAppName = escapeHtmlEntities(context.config.appName)
  const escapedAppAddress = escapeHtmlEntities(context.config.appAddress)
  const escapedVersion = escapeHtmlEntities(context.config.polrVersion)
  const escapedReleaseDate = escapeHtmlEntities(context.config.polrReleaseDate)
  const generatedSuffix = context.config.polrGeneratedAt !== null
    ? ` on ${escapeHtmlEntities(context.config.polrGeneratedAt)}`
    : ''

  const adminBuildInfo = context.currentUser?.role === 'admin'
    ? `<dl>
        <p>Build Information</p>
        <dt>Version: ${escapedVersion}</dt>
        <dt>Release date: ${escapedReleaseDate}</dt>
        <dt>App Install: ${escapedAppName} on ${escapedAppAddress}${generatedSuffix}</dt>
    </dl>
    <p>You are seeing the information above because you are logged in as an administrator.</p>`
    : ''

  const contentHtml = `<div class='well'>
    <img class='logo-img' src='/img/logo.png' />
</div>

<div class='about-contents'>
    ${adminBuildInfo}
    <p>${escapedAppName} is powered by Polr, an open source, minimalist link shortening platform. The Polr Project is in no way associated with this site.
        Learn more at <a href='https://github.com/Cydrobolt/polr' rel='noopener noreferrer'>its GitHub page</a>.
        <br />Polr is licensed under the GNU GPL License.
    </p>
</div>`

  return renderBaseLayout({
    ...context,
    extraStylesheets: ['/css/about.css'],
    noDivPadding: true,
    contentHtml,
  })
}

export function renderAdminDashboardPage(context: PageRenderContext, user: UserRecord): string {
  const escapedAppName = escapeHtmlEntities(context.config.appName)
  const escapedCsrfToken = escapeHtmlEntities(context.csrfToken)
  const escapedApiKey = escapeHtmlEntities(user.apiKey ?? '')
  const isAdmin = user.role === 'admin'

  const adminNavTab = isAdmin
    ? `<li role='presentation' class='admin-nav-item'><a href='#admin'>Admin</a></li>`
    : ''

  const developerNavTab = user.apiActive
    ? `<li role='presentation' class='admin-nav-item'><a href='#developer'>Developer</a></li>`
    : ''

  const adminTabPane = isAdmin
    ? `<div role="tabpanel" class="tab-pane" id="admin">
                <h3>Links</h3>
                <table id="admin_links_table" class="table table-hover">
                    <thead>
                        <tr>
                            <th>Link Ending</th>
                            <th>Long Link</th>
                            <th>Clicks</th>
                            <th>Date</th>
                            <th>Creator</th>
                            <th>Disable</th>
                            <th>Delete</th>
                        </tr>
                    </thead>
                </table>

                <h3 class="users-heading">Users</h3>
                <a ng-click="state.showNewUserWell = !state.showNewUserWell" class="btn btn-primary btn-sm status-display">New</a>

                <div ng-if="state.showNewUserWell" class="new-user-fields well">
                    <table class="table">
                        <tr>
                            <th>Username</th>
                            <th>Password</th>
                            <th>Email</th>
                            <th>Role</th>
                            <th></th>
                        </tr>
                        <tr id="new-user-form">
                            <td><input type="text" class="form-control" ng-model="newUserParams.username"></td>
                            <td><input type="password" class="form-control" ng-model="newUserParams.userPassword"></td>
                            <td><input type="email" class="form-control" ng-model="newUserParams.userEmail"></td>
                            <td>
                                <select class="form-control new-user-role" ng-model="newUserParams.userRole">
                                    <option value="admin">admin</option>
                                    <option value="">default</option>
                                </select>
                            </td>
                            <td>
                                <a ng-click="addNewUser($event)" class="btn btn-primary btn-sm status-display new-user-add">Add</a>
                            </td>
                        </tr>
                    </table>
                </div>

                <table id="admin_users_table" class="table table-hover">
                    <thead>
                        <tr>
                            <th>Username</th>
                            <th>Email</th>
                            <th>Created At</th>
                            <th>Activated</th>
                            <th>API</th>
                            <th>Role</th>
                            <th>Delete</th>
                        </tr>
                    </thead>
                </table>
            </div>`
    : ''

  const quotaDisplayHtml = user.apiQuota === -1
    ? 'unlimited'
    : `<code>${escapeHtmlEntities(String(user.apiQuota))}</code>`

  const developerTabPane = user.apiActive
    ? `<div role="tabpanel" class="tab-pane" id="developer">
                <h3>Developer</h3>

                <p>API keys and endpoints for programmatic link shortening.</p>
                <p>
                    Endpoints: <code>/api/v2/action/shorten</code>, <code>/api/v2/action/shorten_bulk</code>, <code>/api/v2/action/lookup</code>
                </p>

                <h4>API Key: </h4>
                <div class='row'>
                    <div class='col-md-8'>
                        <input class='form-control status-display' disabled type='text' value='${escapedApiKey}'>
                    </div>
                    <div class='col-md-4'>
                        <a href='#' ng-click="generateNewAPIKey($event, '${user.id}', true)" id='api-reset-key' class='btn btn-danger'>Reset</a>
                    </div>
                </div>

                <h4>API Quota: </h4>
                <h2 class='api-quota'>
                    ${quotaDisplayHtml}
                </h2>
                <span> requests per minute</span>
            </div>`
    : ''

  const contentHtml = `<div ng-controller="AdminCtrl" class="ng-root">
    <div class='col-md-2'>
        <ul class='nav nav-pills nav-stacked admin-nav' role='tablist'>
            <li role='presentation' aria-controls="home" class='admin-nav-item active'><a href='#home'>Home</a></li>
            <li role='presentation' aria-controls="links" class='admin-nav-item'><a href='#links'>Links</a></li>
            <li role='presentation' aria-controls="settings" class='admin-nav-item'><a href='#settings'>Settings</a></li>
            ${adminNavTab}
            ${developerNavTab}
        </ul>
    </div>
    <div class='col-md-10'>
        <div class="tab-content">
            <div role="tabpanel" class="tab-pane active" id="home">
                <h2>Welcome to your ${escapedAppName} dashboard!</h2>
                <p>Use the links on the left hand side to navigate your ${escapedAppName} dashboard.</p>
            </div>

            <div role="tabpanel" class="tab-pane" id="links">
                <table id="user_links_table" class="table table-hover">
                    <thead>
                        <tr>
                            <th>Link Ending</th>
                            <th>Long Link</th>
                            <th>Clicks</th>
                            <th>Date</th>
                        </tr>
                    </thead>
                </table>
            </div>

            <div role="tabpanel" class="tab-pane" id="settings">
                <h3>Change Password</h3>
                <form action='/admin/action/change_password' method='POST'>
                    Old Password: <input class="form-control password-box" type='password' name='current_password' />
                    New Password: <input class="form-control password-box" type='password' name='new_password' />
                    <input type="hidden" name='_token' value='${escapedCsrfToken}' />
                    <input type='submit' class='btn btn-success change-password-btn'/>
                </form>
            </div>

            ${adminTabPane}
            ${developerTabPane}
        </div>
    </div>

    <div class="angular-modals">
        <edit-long-link-modal ng-repeat="modal in modals.editLongLink" link-ending="modal.linkEnding"
            old-long-link="modal.oldLongLink" clean-modals="cleanModals"></edit-long-link-modal>
        <edit-user-api-info-modal ng-repeat="modal in modals.editUserApiInfo" user-id="modal.userId"
            api-quota="modal.apiQuota" api-active="modal.apiActive" api-key="modal.apiKey"
            generate-new-api-key="generateNewAPIKey" clean-modals="cleanModals"></edit-user-api-info-modal>
    </div>
</div>`

  return renderBaseLayout({
    ...context,
    extraStylesheets: ['/css/admin.css', '/css/datatables.min.css'],
    extraScripts: ['/js/datatables.min.js', '/js/api.js', '/js/AdminCtrl.js'],
    contentHtml,
  })
}

export function renderErrorPage(context: PageRenderContext, message: string): string {
  const escapedMessage = escapeHtmlEntities(message)
  return renderBaseLayout({
    ...context,
    noIndexMeta: true,
    contentHtml: `<h2>Error</h2>\n<h4>${escapedMessage}</h4>`,
  })
}

export function renderNotFoundPage(context: PageRenderContext): string {
  return renderBaseLayout({
    ...context,
    noIndexMeta: true,
    contentHtml: `<h1>404</h1>\n<p>This page could not be found.</p>`,
  })
}

export function renderServerErrorPage(context: PageRenderContext): string {
  return renderBaseLayout({
    ...context,
    noIndexMeta: true,
    contentHtml: `<h1>500</h1>\n<p>Oh dear. Something seems to have gone awry.</p>\n<h4>Please contact an administrator to report this issue.</h4>`,
  })
}
