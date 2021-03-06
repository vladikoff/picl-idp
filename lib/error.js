/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var inherits = require('util').inherits
var messages = require('joi/lib/language').errors

var ERRNO = {
  SERVER_CONFIG_ERROR: 100,
  ACCOUNT_EXISTS: 101,
  ACCOUNT_UNKNOWN: 102,
  INCORRECT_PASSWORD: 103,
  ACCOUNT_UNVERIFIED: 104,
  INVALID_VERIFICATION_CODE: 105,
  INVALID_JSON: 106,
  INVALID_PARAMETER: 107,
  MISSING_PARAMETER: 108,
  INVALID_REQUEST_SIGNATURE: 109,
  INVALID_TOKEN: 110,
  INVALID_TIMESTAMP: 111,
  MISSING_CONTENT_LENGTH_HEADER: 112,
  REQUEST_TOO_LARGE: 113,
  THROTTLED: 114,
  INVALID_NONCE: 115,
  ENDPOINT_NOT_SUPPORTED: 116,
  INCORRECT_EMAIL_CASE: 120,
  // ACCOUNT_LOCKED: 121,
  // ACCOUNT_NOT_LOCKED: 122,
  DEVICE_UNKNOWN: 123,
  DEVICE_CONFLICT: 124,
  REQUEST_BLOCKED: 125,
  ACCOUNT_RESET: 126,
  INVALID_UNBLOCK_CODE: 127,
  // MISSING_TOKEN: 128,
  INVALID_PHONE_NUMBER: 129,
  INVALID_REGION: 130,
  INVALID_MESSAGE_ID: 131,
  MESSAGE_REJECTED: 132,
  SERVER_BUSY: 201,
  FEATURE_NOT_ENABLED: 202,
  UNEXPECTED_ERROR: 999
}

var DEFAULTS = {
  code: 500,
  error: 'Internal Server Error',
  errno: ERRNO.UNEXPECTED_ERROR,
  message: 'Unspecified error',
  info: 'https://github.com/mozilla/fxa-auth-server/blob/master/docs/api.md#response-format'
}

var TOO_LARGE = /^Payload (?:content length|size) greater than maximum allowed/

var BAD_SIGNATURE_ERRORS = [
  'Bad mac',
  'Unknown algorithm',
  'Missing required payload hash',
  'Payload is invalid'
]

function AppError(options, extra, headers) {
  this.message = options.message || DEFAULTS.message
  this.isBoom = true
  this.stack = options.stack
  if (! this.stack) {
    Error.captureStackTrace(this, AppError)
  }
  this.errno = options.errno || DEFAULTS.errno
  this.output = {
    statusCode: options.code || DEFAULTS.code,
    payload: {
      code: options.code || DEFAULTS.code,
      errno: this.errno,
      error: options.error || DEFAULTS.error,
      message: this.message,
      info: options.info || DEFAULTS.info
    },
    headers: headers || {}
  }
  var keys = Object.keys(extra || {})
  for (var i = 0; i < keys.length; i++) {
    this.output.payload[keys[i]] = extra[keys[i]]
  }
}
inherits(AppError, Error)

AppError.prototype.toString = function () {
  return 'Error: ' + this.message
}

AppError.prototype.header = function (name, value) {
  this.output.headers[name] = value
}

AppError.prototype.backtrace = function (traced) {
  this.output.payload.log = traced
}

/*/
  Translates an error from Hapi format to our format
/*/
AppError.translate = function (response) {
  var error
  if (response instanceof AppError) {
    return response
  }
  var payload = response.output.payload
  if (! payload) {
    error = new AppError({})
  } else if (payload.statusCode === 401) {
    // These are common errors generated by Hawk auth lib.
    if (payload.message === 'Unknown credentials' ||
        payload.message === 'Invalid credentials') {
      error = AppError.invalidToken('Invalid authentication token: ' + payload.message)
    }
    else if (payload.message === 'Stale timestamp') {
      error = AppError.invalidTimestamp()
    }
    else if (payload.message === 'Invalid nonce') {
      error = AppError.invalidNonce()
    }
    else if (BAD_SIGNATURE_ERRORS.indexOf(payload.message) !== -1) {
      error = AppError.invalidSignature(payload.message)
    }
    else {
      error = AppError.invalidToken('Invalid authentication token: ' + payload.message)
    }
  }
  else if (payload.validation) {
    if (payload.message && payload.message.indexOf(messages.any.required) >= 0) {
      error = AppError.missingRequestParameter(payload.validation.keys[0])
    } else {
      error = AppError.invalidRequestParameter(payload.validation)
    }
  }
  else if (payload.statusCode === 400 && TOO_LARGE.test(payload.message)) {
    error = AppError.requestBodyTooLarge()
  }
  else {
    error = new AppError({
      message: payload.message,
      code: payload.statusCode,
      error: payload.error,
      errno: payload.errno,
      info: payload.info,
      stack: response.stack
    })
  }
  return error
}

// Helper functions for creating particular response types.

AppError.dbIncorrectPatchLevel = function (level, levelRequired) {
  return new AppError(
    {
      code: 400,
      error: 'Server Startup',
      errno: ERRNO.SERVER_CONFIG_ERROR,
      message: 'Incorrect Database Patch Level'
    },
    {
      level: level,
      levelRequired: levelRequired
    }
  )
}

AppError.accountExists = function (email) {
  return new AppError(
    {
      code: 400,
      error: 'Bad Request',
      errno: ERRNO.ACCOUNT_EXISTS,
      message: 'Account already exists'
    },
    {
      email: email
    }
  )
}

AppError.unknownAccount = function (email) {
  return new AppError(
    {
      code: 400,
      error: 'Bad Request',
      errno: ERRNO.ACCOUNT_UNKNOWN,
      message: 'Unknown account'
    },
    {
      email: email
    }
  )
}

AppError.incorrectPassword = function (dbEmail, requestEmail) {
  if (dbEmail !== requestEmail) {
    return new AppError(
      {
        code: 400,
        error: 'Bad Request',
        errno: ERRNO.INCORRECT_EMAIL_CASE,
        message: 'Incorrect email case'
      },
      {
        email: dbEmail
      }
    )
  }
  return new AppError(
    {
      code: 400,
      error: 'Bad Request',
      errno: ERRNO.INCORRECT_PASSWORD,
      message: 'Incorrect password'
    },
    {
      email: dbEmail
    }
  )
}

AppError.unverifiedAccount = function () {
  return new AppError({
    code: 400,
    error: 'Bad Request',
    errno: ERRNO.ACCOUNT_UNVERIFIED,
    message: 'Unverified account'
  })
}

AppError.invalidVerificationCode = function (details) {
  return new AppError(
    {
      code: 400,
      error: 'Bad Request',
      errno: ERRNO.INVALID_VERIFICATION_CODE,
      message: 'Invalid verification code'
    },
    details
  )
}

AppError.invalidRequestBody = function () {
  return new AppError({
    code: 400,
    error: 'Bad Request',
    errno: ERRNO.INVALID_JSON,
    message: 'Invalid JSON in request body'
  })
}

AppError.invalidRequestParameter = function (validation) {
  return new AppError(
    {
      code: 400,
      error: 'Bad Request',
      errno: ERRNO.INVALID_PARAMETER,
      message: 'Invalid parameter in request body'
    },
    {
      validation: validation
    }
  )
}

AppError.missingRequestParameter = function (param) {
  return new AppError(
    {
      code: 400,
      error: 'Bad Request',
      errno: ERRNO.MISSING_PARAMETER,
      message: 'Missing parameter in request body' + (param ? ': ' + param : '')
    },
    {
      param: param
    }
  )
}

AppError.invalidSignature = function (message) {
  return new AppError({
    code: 401,
    error: 'Unauthorized',
    errno: ERRNO.INVALID_REQUEST_SIGNATURE,
    message: message || 'Invalid request signature'
  })
}

AppError.invalidToken = function (message) {
  return new AppError({
    code: 401,
    error: 'Unauthorized',
    errno: ERRNO.INVALID_TOKEN,
    message: message || 'Invalid authentication token in request signature'
  })
}

AppError.invalidTimestamp = function () {
  return new AppError(
    {
      code: 401,
      error: 'Unauthorized',
      errno: ERRNO.INVALID_TIMESTAMP,
      message: 'Invalid timestamp in request signature'
    },
    {
      serverTime: Math.floor(+new Date() / 1000)
    }
  )
}

AppError.invalidNonce = function () {
  return new AppError({
    code: 401,
    error: 'Unauthorized',
    errno: ERRNO.INVALID_NONCE,
    message: 'Invalid nonce in request signature'
  })
}

AppError.missingContentLength = function () {
  return new AppError({
    code: 411,
    error: 'Length Required',
    errno: ERRNO.MISSING_CONTENT_LENGTH_HEADER,
    message: 'Missing content-length header'
  })
}

AppError.requestBodyTooLarge = function () {
  return new AppError({
    code: 413,
    error: 'Request Entity Too Large',
    errno: ERRNO.REQUEST_TOO_LARGE,
    message: 'Request body too large'
  })
}

AppError.tooManyRequests = function (retryAfter, retryAfterLocalized, canUnblock) {
  if (! retryAfter) {
    retryAfter = 30
  }

  var extraData = {
    retryAfter: retryAfter
  }

  if (retryAfterLocalized) {
    extraData.retryAfterLocalized = retryAfterLocalized
  }

  if (canUnblock) {
    extraData.verificationMethod = 'email-captcha'
    extraData.verificationReason = 'login'
  }

  return new AppError(
    {
      code: 429,
      error: 'Too Many Requests',
      errno: ERRNO.THROTTLED,
      message: 'Client has sent too many requests'
    },
    extraData,
    {
      'retry-after': retryAfter
    }
  )
}

AppError.requestBlocked = function (canUnblock) {
  var extra
  if (canUnblock) {
    extra = {
      verificationMethod: 'email-captcha',
      verificationReason: 'login'
    }
  }
  return new AppError({
    code: 400,
    error: 'Request blocked',
    errno: ERRNO.REQUEST_BLOCKED,
    message: 'The request was blocked for security reasons'
  }, extra)
}

AppError.serviceUnavailable = function (retryAfter) {
  if (! retryAfter) {
    retryAfter = 30
  }
  return new AppError(
    {
      code: 503,
      error: 'Service Unavailable',
      errno: ERRNO.SERVER_BUSY,
      message: 'Service unavailable'
    },
    {
      retryAfter: retryAfter
    },
    {
      'retry-after': retryAfter
    }
  )
}

AppError.featureNotEnabled = function (retryAfter) {
  if (! retryAfter) {
    retryAfter = 30
  }
  return new AppError(
    {
      code: 503,
      error: 'Feature not enabled',
      errno: ERRNO.FEATURE_NOT_ENABLED,
      message: 'Service unavailable'
    },
    {
      retryAfter: retryAfter
    },
    {
      'retry-after': retryAfter
    }
  )
}

AppError.gone = function () {
  return new AppError({
    code: 410,
    error: 'Gone',
    errno: ERRNO.ENDPOINT_NOT_SUPPORTED,
    message: 'This endpoint is no longer supported'
  })
}

AppError.mustResetAccount = function (email) {
  return new AppError(
    {
      code: 400,
      error: 'Bad Request',
      errno: ERRNO.ACCOUNT_RESET,
      message: 'Account must be reset'
    },
    {
      email: email
    }
  )
}

AppError.unknownDevice = function () {
  return new AppError(
    {
      code: 400,
      error: 'Bad Request',
      errno: ERRNO.DEVICE_UNKNOWN,
      message: 'Unknown device'
    }
  )
}

AppError.deviceSessionConflict = function () {
  return new AppError(
    {
      code: 400,
      error: 'Bad Request',
      errno: ERRNO.DEVICE_CONFLICT,
      message: 'Session already registered by another device'
    }
  )
}

AppError.invalidUnblockCode = function () {
  return new AppError({
    code: 400,
    error: 'Bad Request',
    errno: ERRNO.INVALID_UNBLOCK_CODE,
    message: 'Invalid unblock code'
  })
}

AppError.invalidPhoneNumber = () => {
  return new AppError({
    code: 400,
    error: 'Bad Request',
    errno: ERRNO.INVALID_PHONE_NUMBER,
    message: 'Invalid phone number'
  })
}

AppError.invalidRegion = region => {
  return new AppError({
    code: 400,
    error: 'Bad Request',
    errno: ERRNO.INVALID_REGION,
    message: 'Invalid region'
  }, {
    region
  })
}

AppError.invalidMessageId = () => {
  return new AppError({
    code: 400,
    error: 'Bad Request',
    errno: ERRNO.INVALID_MESSAGE_ID,
    message: 'Invalid message id'
  })
}

AppError.messageRejected = (reason, reasonCode) => {
  return new AppError({
    code: 500,
    error: 'Bad Request',
    errno: ERRNO.MESSAGE_REJECTED,
    message: 'Message rejected'
  }, {
    reason,
    reasonCode
  })
}

AppError.unexpectedError = () => {
  return new AppError({})
}

module.exports = AppError
module.exports.ERRNO = ERRNO
