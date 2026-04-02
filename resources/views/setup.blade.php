<!DOCTYPE html>
<html>
    <head>
        <title>Polr Setup</title>
        <link rel='stylesheet' href='/css/default-bootstrap.min.css'>
        <link rel='stylesheet' href='/css/setup.css'>
    </head>
    <body>
        <div class='container'>
            <div class="navbar navbar-default navbar-fixed-top">
                <a class="navbar-brand" href="/">Polr</a>
            </div>

            <div class="row">
                <div class='col-md-3'></div>

                <div class='col-md-6 setup-body well'>
                    <div class='setup-center'>
                        <img class='setup-logo' src='/img/logo.png'>
                    </div>

                    <form class='setup-form' method='POST' action='/setup'>
                        <h4>Database Configuration</h4>

                        <p>Database Host:</p>
                        <input type='text' class='form-control' name='db:host' value='localhost'>

                        <p>Database Port:</p>
                        <input type='text' class='form-control' name='db:port' value='3306'>

                        <p>Database Username:</p>
                        <input type='text' class='form-control' name='db:username' value='root'>

                        <p>Database Password:</p>
                        <input type='password' class='form-control' name='db:password' value='password'>

                        <p>
                            Database Name:
                        </p>
                        <input type='text' class='form-control' name='db:name' value='polr'>
                        <p class="text-muted"><small>Name of existing database. You must create the Polr database manually.</small></p>


                        <h4>Application Settings</h4>

                        <p>Application Name:</p>
                        <input type='text' class='form-control' name='app:name' value='Polr'>

                        <p>Application Protocol:</p>
                        <input type='text' class='form-control' name='app:protocol' value='http://'>

                        <p>Application URL (path to Polr; do not include http:// or trailing slash):</p>
                        <input type='text' class='form-control' name='app:external_url' value='yoursite.com'>

                        <p>
                            Advanced Analytics:
                        </p>
                        <select name='setting:adv_analytics' class='form-control'>
                            <option value='false' selected='selected'>Disable advanced analytics</option>
                            <option value='true'>Enable advanced analytics</option>
                        </select>
                        <p class="text-muted"><small>Enable advanced analytics to collect data such as referers, geolocation, and clicks over time. Enabling advanced analytics reduces performance and increases disk space usage.</small></p>

                        <p>
                            MaxMind GeoIP License Key (required for advanced analytics only):
                        </p>
                        <input type='text' class='form-control' name='maxmind:license_key' value=''>

                        <p class='text-muted'>
                            To obtain a free MaxMind GeoIP license key, follow <a href="https://docs.polrproject.org/en/latest/user-guide/maxmind-license">these instructions</a> on Polr's documentation website.
                        </p>

                        <p>Shortening Permissions:</p>
                        <select name='setting:shorten_permission' class='form-control'>
                            <option value='false' selected='selected'>Anyone can shorten URLs</option>
                            <option value='true'>Only logged in users may shorten URLs</option>
                        </select>

                        <p>Public Interface:</p>
                        <select name='setting:public_interface' class='form-control'>
                            <option value='true' selected='selected'>Show public interface (default)</option>
                            <option value='false'>Redirect index page to redirect URL</option>
                        </select>

                        <p>404s and Disabled Short Links:</p>
                        <select name='setting:redirect_404' class='form-control'>
                            <option value='false' selected='selected'>Show an error message (default)</option>
                            <option value='true'>Redirect to redirect URL</option>
                        </select>

                        <p>
                            Redirect URL:
                        </p>
                        <input type='text' class='form-control' name='setting:index_redirect' placeholder='http://your-main-site.com'>
                        <p class='text-muted'>
                            <small>Required if you wish to redirect the index page or 404s to a different website. To use Polr, login by directly heading to yoursite.com/login first.</small>
                        </p>
                        <p class='text-muted'>
                            If a redirect is enabled, you will need to go to
                            http://yoursite.com/login before you can access the index
                            page.
                        </p>

                        <p>
                            Default URL Ending Type:
                        </p>
                        <select name='setting:pseudor_ending' class='form-control'>
                            <option value='false' selected='selected'>Use base62 or base32 counter (shorter but more predictable, e.g 5a)</option>
                            <option value='true'>Use pseudorandom strings (longer but less predictable, e.g 6LxZ3j)</option>
                        </select>
                        <p class="text-muted"><small>If you choose to use pseudorandom strings, you will not have the option to use a counter-based ending.</small></p>

                        <p>
                            URL Ending Base:
                        </p>
                        <select name='setting:base' class='form-control'>
                            <option value='32' selected='selected'>32 -- lowercase letters & numbers (default)</option>
                            <option value='62'>62 -- lowercase, uppercase letters & numbers</option>
                        </select>
                        <p class="text-muted"><small>This will have no effect if you choose to use pseudorandom endings.</small></p>

                        <h4>
                            Admin Account Settings
                        </h4>
                        <p class="text-muted"><small>These credentials will be used for your admin account in Polr.</small></p>

                        <p>Admin Username:</p>
                        <input type='text' class='form-control' name='acct:username' value='polr'>

                        <p>Admin Email:</p>
                        <input type='text' class='form-control' name='acct:email' value='polr@admin.tld'>

                        <p>Admin Password:</p>
                        <input type='password' class='form-control' name='acct:password' value='polr'>

                        <h4>
                            SMTP Settings
                        </h4>
                        <p class="text-muted"><small>Required only if the email verification or password recovery features are enabled. </small></p>

                        <p>SMTP Server:</p>
                        <input type='text' class='form-control' name='app:smtp_server' placeholder='smtp.gmail.com'>

                        <p>SMTP Port:</p>
                        <input type='text' class='form-control' name='app:smtp_port' placeholder='25'>

                        <p>SMTP Username:</p>
                        <input type='text' class='form-control' name='app:smtp_username' placeholder='example@gmail.com'>

                        <p>SMTP Password:</p>
                        <input type='password' class='form-control' name='app:smtp_password' placeholder='password'>

                        <p>SMTP From:</p>
                        <input type='text' class='form-control' name='app:smtp_from' placeholder='example@gmail.com'>
                        <p>SMTP From Name:</p>
                        <input type='text' class='form-control' name='app:smtp_from_name' placeholder='noreply'>

                        <h4>API Settings</h4>

                        <p>Anonymous API:</p>
                        <select name='setting:anon_api' class='form-control'>
                            <option selected value='false'>Off -- only registered users can use API</option>
                            <option value='true'>On -- empty key API requests are allowed</option>
                        </select>

                        <p>
                            Anonymous API Quota:
                        </p>
                        <input type='text' class='form-control' name='setting:anon_api_quota' placeholder='10'>
                        <p class="text-muted"><small>API quota for non-authenticated users per minute per IP.</small></p>

                        <p>Automatic API Assignment:</p>
                        <select name='setting:auto_api_key' class='form-control'>
                            <option selected value='false'>Off -- admins must manually enable API for each user</option>
                            <option value='true'>On -- each user receives an API key on signup</option>
                        </select>

                        <h4>Other Settings</h4>

                        <p>
                            Registration:
                        </p>
                        <select name='setting:registration_permission' class='form-control'>
                            <option value='none'>Registration disabled</option>
                            <option value='email'>Enabled, email verification required</option>
                            <option value='no-verification'>Enabled, no email verification required</option>
                        </select>
                        <p class="text-muted"><small>Enabling registration allows any user to create an account.</small></p>

                        <p>
                            Restrict Registration Email Domains:
                        </p>
                        <select name='setting:restrict_email_domain' class='form-control'>
                            <option value='false'>Allow any email domain to register</option>
                            <option value='true'>Restrict email domains allowed to register</option>
                        </select>
                        <p class="text-muted"><small>Restrict registration to certain email domains.</small></p>

                        <p>
                            Permitted Email Domains:
                        </p>
                        <input type='text' class='form-control' name='setting:allowed_email_domains' placeholder='company.com,company-corp.com'>
                        <p class="text-muted"><small>A comma-separated list of emails permitted to register.</small></p>

                        <p>
                            Password Recovery:
                        </p>
                        <select name='setting:password_recovery' class='form-control'>
                            <option value='false'>Password recovery disabled</option>
                            <option value='true'>Password recovery enabled</option>
                        </select>
                        <p class="text-muted"><small>Password recovery allows users to reset their password through email.</small></p>
                        <p class='text-muted'>
                            Please ensure SMTP is properly set up before enabling password recovery.
                        </p>

                        <p>
                            Require reCAPTCHA for Registrations
                        </p>
                        <select name='setting:acct_registration_recaptcha' class='form-control'>
                            <option value='false'>Do not require reCAPTCHA for registration</option>
                            <option value='true'>Require reCATPCHA for registration</option>
                        </select>
                        <p class="text-muted"><small>You must provide your reCAPTCHA keys to use this feature.</small></p>

                        <p>
                            reCAPTCHA Configuration:
                        </p>

                        <p>
                            reCAPTCHA Site Key
                        </p>
                        <input type='text' class='form-control' name='setting:recaptcha_site_key'>

                        <p>
                            reCAPTCHA Secret Key
                        </p>
                        <input type='text' class='form-control' name='setting:recaptcha_secret_key'>
                        <p class="text-muted"><small>You must provide reCAPTCHA keys if you intend to use any reCAPTCHA-dependent features.</small></p>

                        <p class='text-muted'>
                            You can obtain reCAPTCHA keys from <a href="https://www.google.com/recaptcha/admin">Google's reCAPTCHA website</a>.
                        </p>

                        <div class='setup-form-buttons'>
                            <input type='submit' class='btn btn-success' value='Install'>
                            <input type='reset' class='btn btn-warning' value='Clear Fields'>
                        </div>
                        <input type="hidden" name='_token' value='{{csrf_token()}}' />
                    </form>
                </div>

                <div class='col-md-3'></div>
            </div>

            <div class='setup-footer well'>
                Polr is <a href='https://opensource.org/osd' target='_blank'>open-source
                software</a> licensed under the <a href='//www.gnu.org/copyleft/gpl.html'>GPLv2+
                License</a>.

                <div>
                    Polr Version {{env('VERSION')}} released {{env('VERSION_RELMONTH')}} {{env('VERSION_RELDAY')}}, {{env('VERSION_RELYEAR')}} -
                    <a href='//github.com/cydrobolt/polr' target='_blank'>Github</a>

                    <div class='footer-well'>
                        &copy; Copyright {{env('VERSION_RELYEAR')}}
                        <a class='footer-link' href='//cydrobolt.com' target='_blank'>Chaoyi Zha</a> &amp;
                        <a class='footer-link' href='//github.com/Cydrobolt/polr/graphs/contributors' target='_blank'>other Polr contributors</a>
                    </div>
                </div>
            </div>
        </div>
    </body>
</html>
