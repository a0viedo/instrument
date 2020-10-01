# Instrument

[![npm](https://img.shields.io/npm/v/instrument)](https://www.npmjs.com/package/instrument)
![node-current](https://img.shields.io/node/v/instrument)
[![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/a0viedo/instrument/blob/master/LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)
[![Language grade: JavaScript](https://img.shields.io/lgtm/grade/javascript/g/a0viedo/instrument.svg?logo=lgtm&logoWidth=18)](https://lgtm.com/projects/g/a0viedo/instrument/context:javascript)

A tool that collects information about calls made to Node.js native modules.


## Installation
To add it as a development dependency run:

```
npm i instrument --save-dev
```

## Usage
Loading it programatically (using default configuration):
```js
require('instrument')()
```

You can also include it by using the `-r` or `--require` flag in your command:

```
$ node -r instrument/config my-app.js
```

## Configuration
`instrument` accepts a configuration object if it's being loaded programatically or you could create a `instrument.config.js` file in case you're including it via the `--require` flag.

Example of a `instrument.config.js` file:
```js
module.exports = {
  summary: true,
  frequency: true,
  output: 'my-instrumentation-logs.txt'
}
```


### Configuration properties
#### dependencies
Specifies if dependencies should be instrumented. Default value is `false`.
#### summary
Enable this property to print a summary of the instrumented calls that were captured. Default value is `true`.
#### structured
It changes the log output to be JSON formatted. Default value is `false`.
#### frequency
In case "summary" property is set to `true`, then also prints a frequency indicator for each call.
#### output
If you want to avoid printing the output to `stdout` you can specify a file to be used for logging.
#### modules
It accepts an array of the native modules you want to be instrumented. Default values are `["child_process","http","https","fs","require"]`.
#### runtimeLogs
Enables or disables the logging at runtime for instrumented calls. Default value is `false`.

## License
MIT