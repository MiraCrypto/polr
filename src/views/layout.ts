import type { ApplicationConfiguration } from '../config.js'
import type { FlashMessage, UserRecord } from '../domain/types.js'
import { escapeHtmlEntities } from './dataTables.js'

export interface BaseLayoutParameters {
  readonly config: ApplicationConfiguration
  readonly title?: string
  readonly csrfToken: string
  readonly currentUser: UserRecord | null
  readonly flashMessages: readonly FlashMessage[]
  readonly extraStylesheets?: readonly string[]
  readonly extraScripts?: readonly string[]
  readonly contentHtml: string
  readonly noDivPadding?: boolean
  readonly largeJumbotron?: boolean
  readonly noIndexMeta?: boolean
}

function renderNavbarHtml(
  config: ApplicationConfiguration,
  currentUser: UserRecord | null,
): string {
  const escapedAppName = escapeHtmlEntities(config.appName)

  const mobileLinks = currentUser === null
    ? `<li class="visible-xs"><a href="/login">Sign In</a></li>`
    : `<li class="visible-xs"><a href="/admin">Dashboard</a></li>
                <li class="visible-xs"><a href="/admin#settings">Settings</a></li>
                <li class="visible-xs"><a href="/logout">Logout</a></li>`

  const desktopAuthSection = currentUser === null
    ? `<li><a href="/login">Sign In</a></li>`
    : `<div class='nav pull-right navbar-nav'>
                    <li class='dropdown'>
                    <a class="dropdown-toggle login-name" href="#" data-toggle="dropdown">${escapeHtmlEntities(currentUser.username)} <strong class="caret"></strong></a>
                        <ul class="dropdown-menu pull-right" role="menu" aria-labelledby="dropdownMenu">
                            <li><a tabindex="-1" href="/admin">Dashboard</a></li>
                            <li><a tabindex="-1" href="/admin#settings">Settings</a></li>
                            <li><a tabindex="-1" href="/logout">Logout</a></li>
                        </ul>
                    </li>
                </div>`

  return `<div class="container-fluid">
    <nav role="navigation" class="navbar navbar-default navbar-fixed-top">
        <button type="button" class="navbar-toggle collapsed" data-toggle="collapse" data-target="#navbar" aria-expanded="false" aria-controls="navbar">
            <span class="sr-only">Toggle navigation</span>
            <span class="icon-bar"></span>
            <span class="icon-bar"></span>
            <span class="icon-bar"></span>
        </button>

        <div class="navbar-header">
            <a class="navbar-brand" href="/">${escapedAppName}</a>
        </div>

        <ul id="navbar" class="nav navbar-collapse collapse navbar-nav">
            <li><a href="/about-polr">About</a></li>
            ${mobileLinks}
        </ul>

        <ul class="nav pull-right navbar-nav hidden-xs">
            <li class="divider-vertical"></li>
            ${desktopAuthSection}
        </ul>
    </nav>
</div>`
}

function serializeJsStringLiteralForInlineScript(rawText: string): string {
  return JSON.stringify(rawText).replace(/</g, '\\u003c')
}

function renderToastrScriptBlock(flashMessages: readonly FlashMessage[]): string {
  const statements: string[] = []
  for (const flash of flashMessages) {
    const title = flash.type.charAt(0).toUpperCase() + flash.type.slice(1)
    const serializedType = serializeJsStringLiteralForInlineScript(flash.type)
    const serializedMessage = serializeJsStringLiteralForInlineScript(escapeHtmlEntities(flash.message))
    const serializedTitle = serializeJsStringLiteralForInlineScript(title)
    statements.push(`toastr[${serializedType}](${serializedMessage}, ${serializedTitle})`)
  }
  return `<script>
    ${statements.join('\n    ')}
    </script>`
}

export function renderBaseLayout(parameters: BaseLayoutParameters): string {
  const pageTitle = escapeHtmlEntities(parameters.title ?? parameters.config.appName)
  const escapedCsrfToken = escapeHtmlEntities(parameters.csrfToken)
  const escapedGenerator = escapeHtmlEntities(`Polr ${parameters.config.polrVersion}`)

  const metaHtml = parameters.noIndexMeta === true
    ? `<meta http-equiv="Cache-Control" content="no-cache, no-store, max-age=0, must-revalidate" />
<meta http-equiv="Pragma" content="no-cache" />
<meta name="robots" content="noindex" />`
    : ''

  const extraCssHtml = (parameters.extraStylesheets ?? [])
    .map(href => `<link rel="stylesheet" href="${escapeHtmlEntities(href)}" />`)
    .join('\n    ')

  const extraJsHtml = (parameters.extraScripts ?? [])
    .map(src => `<script src="${escapeHtmlEntities(src)}"></script>`)
    .join('\n    ')

  const contentDivClasses = [
    'content-div',
    parameters.noDivPadding === true
      ? ''
      : 'content-div-padding',
    parameters.largeJumbotron === true
      ? 'jumbotron large-content-div'
      : '',
  ]
    .filter(className => className.length > 0)
    .join(' ')

  return `<!DOCTYPE html>
<html ng-app="polr">
<head>
    <title>${pageTitle}</title>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="csrf-token" content="${escapedCsrfToken}">
    <meta name="generator" content="${escapedGenerator}" />
    ${metaHtml}

    <link rel="stylesheet" href="/css/default-bootstrap.min.css">
    <link href="/css/base.css" rel="stylesheet">
    <link href="/css/toastr.min.css" rel="stylesheet">
    <link href="/css/font-awesome.min.css" rel="stylesheet">

    <link rel="shortcut icon" href="/favicon.ico">
    ${extraCssHtml}
</head>
<body>
    ${renderNavbarHtml(parameters.config, parameters.currentUser)}
    <div class="container">
        <div class="${contentDivClasses}">
            ${parameters.contentHtml}
        </div>
    </div>

    <script src="/js/constants.js"></script>
    <script src="/js/jquery-1.11.3.min.js"></script>
    <script src="/js/bootstrap.min.js"></script>
    <script src="/js/angular.min.js"></script>
    <script src="/js/toastr.min.js"></script>
    <script src="/js/base.js"></script>

    ${renderToastrScriptBlock(parameters.flashMessages)}

    ${extraJsHtml}
</body>
</html>`
}
