const fs = require('fs');
const http = require('http');
const https = require('https');
const childProcess = require('child_process');
const Module = require('module');
const builtinModules = Module.builtinModules;
const path = require('path');
const assert = require('assert');
const TreeModel = require('tree-model');
const colorize = require('json-colorizer');
const tree = new TreeModel();

let summaryMap = {};
const config = {
  structured: false,
  dependencies: false,
  summary: true,
  frequency: false,
  modules: {
    fs: true,
    http: true,
    https: true,
    child_process: true,
    require: true
  }
};
let logStream;
const treeRootName = process.argv[1];
let treeRoot = tree.parse({
  name: 'root',
  path: '.'
});

// original references
const origCreateReadStream = fs.createReadStream;
const origCreateWriteStream = fs.createWriteStream;
const origAppendFileSync = fs.appendFileSync;
const origWriteFileSync = fs.writeFileSync;

function isNodeModulesTarget(request) {
  if (request.startsWith('./') || request.startsWith('..') || path.extname(request) !== '' || builtinModules.includes(request)) {
    return false;
  }

  return true;
}

function resolveRequest(request, parent) {
  if (builtinModules.includes(request)) {
    return request;
  }

  if (isNodeModulesTarget(request)) {
    // if the target is a node module, then to resolve we need to load its package.json and use the "main" property...require.resolve does this for us
    return require.resolve(request, {
      paths: [
        // fs.realpathSync fails for files without extensions...but without it, the function won't work for resolving symlinks
        path.dirname(process.argv[1]), // path for the file we're currently running
        path.dirname(parent && parent.id || ''), // path for where this dependency is coming from (npm flattens the node_modules directory when it can, but there are still cases for when it's nested)
        ...require.resolve.paths(request)]
    });
  }
  return path.resolve(parent && parent.filename, '..', request);
}

function firstNodeFn(treePath, node) {
  // this function is very naive at the moment. it should consider all cases that can be covered by 'require', like require('./directory') could be loading up a file named directory.js or a file in 'directory/index.js'
  return node.model.path === treePath
    || node.model.path === treePath.replace(path.extname(treePath), '');
}

function track(trigger, str) {
  if (config.dependencies === false && isDependency(trigger, str)) {
    return;
  }

  const [module, method] = trigger.split('.');
  if (!summaryMap[module]) {
    // don't track disabled modules
    return;
  }
  if (config.summary) {
    if (typeof method === 'undefined') {
      if (!summaryMap[module]) {
        summaryMap[module] = [];
      }
      summaryMap[module].push(str);
    }
    if (!summaryMap[module][method]) {
      summaryMap[module][method] = [];
    }
    summaryMap[module][method].push(str);

    // TODO: evaluate if it makes sense for summary to be mutually exclusive to logs during runtime
    return;
  }
  log(`${trigger} | ${str}`);
}

function isDependency(trigger, path) {
  if (trigger.includes('fs.')) {
    return path.includes('node_modules');
  }
  return false;
}

function log(message) {
  let record = [];
  const now = new Date().toISOString();
  if (config.structured) {
    record = [JSON.stringify({
      time: now,
      message
    })];
  } else {
    record.push(now, '-', message);
  }
  if (config.output) {
    if (!logStream) {
      logStream = origCreateWriteStream(path.resolve(config.output), { flags: 'a' });
    }
    if (typeof record === 'string') {
      logStream.write(record);
    } else {
      logStream.write(`${record.join(' ')}\r\n`);
    }

  } else {
    logArray(record);
  }
}

function logSync(message, propName = 'log') {
  const parsedMessage = typeof message === 'object' ? JSON.stringify(message) : message;

  let result;
  const now = new Date().toISOString();
  if (config.structured) {

    if (config.output) {
      result = JSON.stringify({
        time: now,
        [propName]: message
      });
    } else {
      result = [{
        time: now,
        [propName]: message
      }];
    }
  } else {
    if (config.output) {
      result = `${new Date().toISOString()} - ${parsedMessage}\r\n`;
    } else {
      result = [new Date().toISOString(), '-', message];
    }
  }
  if (config.output) {
    origWriteFileSync(path.resolve(config.output), result, { flag: 'a' });
  } else {
    logArray(result);
  }
}

function logArray(arr) {
  arr.forEach(elem => {
    if (typeof elem === 'object') {
      process.stdout.write(`${colorize(elem, {
        pretty: true,
        colors: {
          STRING_KEY: 'white',
          STRING_LITERAL: 'green'
        }
      })}\r\n`);
    } else {
      process.stdout.write(`${elem} `)
    }
  });
  process.stdout.write('\r\n');
}

function formatOutput(tree) {
  delete tree.path;
  tree.children.forEach(c => {
    delete c.path;
    formatOutput(c);
  });
}

function insertIntoTree(tree, parentPath, elem) {
  for (const node of tree) {
    if (node.path === parentPath) {
      node.children.push(elem);
      return;
    } else {
      insertIntoTree(node.children, parentPath, elem);
    }
  }
}

function extractHTTPPropertiesFromOptions(options, alternativeOptions, protocol) {
  if (options instanceof URL) {
    return {
      path: `${options.protocol}//${options.host || options.hostname}${options.pathname}`,
      method: alternativeOptions.method
    };
  }
  if (typeof options === 'object') {
    return {
      path: `${protocol}//${options.host || options.hostname}${options.path}`,
      method: options.method
    };
  }
  if (typeof options === 'string') {
    return {
      path: options,
      alternativeOptions
    };
  }
}

function arrayToFrequencyCount(arr) {
  const uniques = [...new Set(arr)];
  const result = {};
  for (const elem of uniques) {
    result[elem] = arr.filter(x => x === elem).length;
  }
  return result;
}

function validateConfig(obj) {
  if (obj) {
    assert(typeof obj === 'object', 'Configuration should be an object');
    if (obj.hasOwnProperty('output')) {
      assert(typeof obj.output === 'string', 'Output should be a string');
    }

    if (obj.hasOwnProperty('modules')) {
      assert(Array.isArray(obj.modules), 'Modules should be an array');
    }

    if(obj.hasOwnProperty('requireTreeOutput')) {
      assert(typeof obj.requireTreeOutput === 'string', 'requireTreeOutput should be a string');
    }
  }
}

function traverseWithCriteria(tree, fns) {
  const results = new Array(fns.length);
  let found = 0;
  tree.walk({
    strategy: 'breadth'
  }, elem => {
    fns.forEach((fn, i) => {
      const result = fn(elem);
      if (result) {
        results[i] = elem;
        found++;
      }
    })
    if (found === fns.length) {
      return false;
    }

  });
  return results;
}

function instrumentFs() {
  const origReadFile = fs.readFile;
  fs.readFile = (...params) => {
    track('fs.readFile', params[0]);
    origReadFile(...params);
  };
  const origWriteFile = fs.writeFile;
  fs.writeFile = (...params) => {
    track('fs.writeFile', params[0]);
    origWriteFile(...params);
  }
  const origReadFileSync = fs.readFileSync;
  fs.readFileSync = (path, options) => {
    track('fs.readFileSync', path, options);
    return origReadFileSync(path, options);
  }

  fs.writeFileSync = (...params) => {
    track('fs.writeFileSync', params[0]);
    return origWriteFileSync(...params);
  }

  const origMkdir = fs.mkdir;
  fs.mkdir = (path, options, callback) => {
    track('fs.mkdir', path);
    return origMkdir(path, options, callback);
  }
  const origMkdirSync = fs.mkdirSync;
  fs.mkdirSync = (path, options) => {
    track('fs.mkdirSync', path);
    return origMkdirSync(path, options);
  }

  const origChmod = fs.chmod;
  fs.chmod = (path, mode, callback) => {
    track('fs.chmod', path);
    return origChmod(path, mode, callback);
  }

  const origCopyFile = fs.copyFile;
  fs.copyFile = (...params) => {
    track('fs.copyFile', `source: ${params[0]}, dest: ${params[1]}`);
    return origCopyFile(...params);
  }

  const origCopyFileSync = fs.copyFileSync;
  fs.copyFileSync = (...params) => {
    track('fs.copyFileSync', `source: ${params[0]}, dest: ${params[1]}`);
    return origCopyFileSync(...params);
  }

  const origExistsSync = fs.existsSync;
  fs.existsSync = (path) => {
    track('fs.existsSync', path);
    return origExistsSync(path);
  }

  const origRename = fs.rename;
  fs.rename = (oldPath, newPath, callback) => {
    track('fs.rename', oldPath);
    return origRename(oldPath, newPath, callback);
  }

  const origRenameSync = fs.renameSync;
  fs.renameSync = (oldPath, newPath) => {
    track('fs.renameSync', `from: ${oldPath} to: ${newPath}`);
    return origRenameSync(oldPath, newPath);
  }

  const origSymlink = fs.symlink;
  fs.symlink = (...params) => {
    track('fs.symlink', params[0]);
    return origSymlink(...params);
  }

  const origUnlink = fs.unlink;
  fs.unlink = (path, callback) => {
    track('fs.unlink', path);
    return origUnlink(path, callback);
  }

  const origReaddir = fs.readdir;
  fs.readdir = (path, options, callback) => {
    track('fs.readdir', path);
    return origReaddir(path, options, callback);
  }

  const origAppendFile = fs.appendFile;
  fs.appendFile = (...params) => {
    track('fs.appendFile', params[0]);
    return origAppendFile(...params);
  }

  fs.appendFileSync = (...params) => {
    track('fs.appendFileSync', params[0]);
    return origAppendFileSync(...params);
  }

  const origStat = fs.stat;
  fs.stat = (path, options, callback) => {
    track('fs.stat', path);
    return origStat(path, options, callback);
  }

  const origStatSync = fs.statSync;
  fs.statSync = (path, options) => {
    track('fs.statSync', path);
    return origStatSync(path, options);
  }

  fs.createReadStream = (path, options) => {
    track('fs.createReadStream', path);
    return origCreateReadStream(path, options);
  }

  fs.createWriteStream = (path, options) => {
    track('fs.createWriteStream', path);
    return origCreateWriteStream(path, options);
  }

  const origRealpath = fs.realpath;
  fs.realpath = (...params) => {
    track('fs.realpath', params[0]);
    return origRealpath(...params);
  }

  const origRealpathSync = fs.realpathSync;
  fs.realpathSync = (...params) => {
    track('fs.realpathSync', params[0]);
    return origRealpathSync(...params);
  }
}

function instrumentChildProcess() {
  const origSpawn = childProcess.spawn;
  childProcess.spawn = (...params) => {
    let trackMessage = params[0];
    if (params[1] && Array.isArray(params[1])) {
      trackMessage = `${params[0]} ${params[1].join(' ')}`;
    }
    track('child_process.spawn', trackMessage);
    return origSpawn(...params);
  };
  const origSpawnSync = childProcess.spawnSync;
  childProcess.spawnSync = (...params) => {
    track('child_process.spawnSync', params[0]);
    return origSpawnSync(...params);
  };
  const origExec = childProcess.exec;
  childProcess.exec = (...params) => {
    track('child_process.exec', params[0]);
    return origExec(...params);
  };
  const origExecSync = childProcess.execSync;
  childProcess.execSync = (...params) => {
    track('child_process.execSync', params[0]);
    return origExecSync(...params);
  };

  const origFork = childProcess.fork;
  childProcess.fork = (...params) => {
    track('child_process.fork', params[0]);
    return origFork(...params);
  };
}

function instrumentHttp() {
  const originalHTTPRequest = http.request;
  http.request = (...params) => {
    const { path, method } = extractHTTPPropertiesFromOptions(params[0], params[1], 'http:');
    track('http.request', `${method.toUpperCase()} ${path}`);
    return originalHTTPRequest(...params);
  };
}

function instrumentHttps() {
  const originalHTTPSRequest = https.request;
  https.request = (...params) => {
    const { path, method } = extractHTTPPropertiesFromOptions(params[0], params[1], 'https:');
    track('https.request', `${method.toUpperCase()} ${path}`);
    return originalHTTPSRequest(...params);
  };
}

function instrumentRequire() {
  const load = Module._load;
  Module._load = function (request, parent) {
    // TODO: add try/catch for this part
    const requestResolved = resolveRequest(request, parent);

    if (parent) {
      const matchFns = [
        elem => elem.model.path === parent.id || elem.model.path === parent.id.replace(path.extname(parent.id), ''),
        elem => elem.model.path === requestResolved || elem.model.path === request,
        firstNodeFn.bind(null, parent.id)
      ];

      const [hasAncestors, alreadyExists, parentNode] = traverseWithCriteria(treeRoot, matchFns);

      if (parent.id === '.' || hasAncestors) {
        if (!alreadyExists) {
          parentNode.addChild(tree.parse({
            path: isNodeModulesTarget(request) && config.dependencies === false ? undefined : requestResolved,
            displayName: isNodeModulesTarget(request) ? request : requestResolved
          }))
        }
        track('require', requestResolved);
      }
    }

    return load.apply(this, arguments);
  }
}

function modulesArrayToObjectMap(arr) {
  return arr.reduce((aggregator, next) => {
    aggregator[next] = true;
    return aggregator;
  }, {});
}

module.exports = function (configParams) {
  const origCwd = process.cwd();

  if (fs.existsSync(path.resolve(origCwd, 'instrument.config.js'))) {
    const fileConfig = require(path.resolve(origCwd, './instrument.config.js'));
    validateConfig(fileConfig);
    if (fileConfig.modules) {
      fileConfig.modules = modulesArrayToObjectMap(fileConfig.modules);
    }

    Object.assign(config, fileConfig);
  }

  validateConfig(configParams);
  if (configParams) {
    if(configParams.modules) {
      configParams.modules = modulesArrayToObjectMap(configParams.modules);
    }
    Object.assign(config, configParams);
  }

  Object.keys(config.modules).forEach(key => {
    if (key === 'require') {
      summaryMap[key] = [];
      return;
    }
    if (config.modules[key] === true) {
      summaryMap[key] = {}
    }
  });

  if (config.modules.fs) {
    instrumentFs()
  }

  if (config.modules.http) {
    instrumentHttp()
  }

  if (config.modules.https) {
    instrumentHttps();
  }

  if (config.modules['child_process']) {
    instrumentChildProcess()
  }

  if (config.modules.require) {
    instrumentRequire();
  }

  if (!config.summary) {
    return;
  }


  // TODO: investigate why beforeExit doesn't work for some processes (e.g. npm ls)
  process.on('exit', () => {
    if (config.frequency === false) {
      // TODO: maybe switch to using a Set from the start and convert it to an array here instead of doing this
      for (const [module, moduleMethods] of Object.entries(summaryMap)) {
        if (Array.isArray(moduleMethods)) {
          summaryMap[module] = [...new Set(moduleMethods)];
          continue;
        }
        for (const [methodName, list] of Object.entries(moduleMethods)) {
          moduleMethods[methodName] = [...new Set(list)];
        }
      }
    } else {
      for (const [module, moduleMethods] of Object.entries(summaryMap)) {
        if (Array.isArray(moduleMethods)) {
          summaryMap[module] = arrayToFrequencyCount(moduleMethods);
          continue;
        }
        for (const [methodName, list] of Object.entries(moduleMethods)) {
          moduleMethods[methodName] = arrayToFrequencyCount(list);
        }
      }
    }

    logSync(summaryMap, 'summary');

    if(config.requireTreeOutput) {
      const graphData = {
        name: '.',
        path: '.',
        parent: null,
        children: []
      };

      treeRoot.walk((elem) => {
        if (elem.parent === undefined) {
          return;
        }
        insertIntoTree([graphData], elem.parent.model.path, {
          path: elem.model.path,
          name: elem.model.displayName,
          children: []
        })
      });

      graphData.name = treeRootName;
      formatOutput(graphData)
      const outputContent = JSON.stringify(graphData);

      origWriteFileSync(path.resolve(origCwd, config.requireTreeOutput), outputContent, { encoding: 'utf8' });
    }
  });
}