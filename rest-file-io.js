// rest-file-io.js: REST File I/O API to securely read and write files in the file system
// Version:   1.1.0
// Copyright: Peter Thoeny, https://github.com/peterthoeny/rest-file-io
// License:   MIT

// required modules
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');

// load rest-file-io configuration - it defines the conf variable
try {
    require('/etc/rest-file-io.conf');
} catch(error) {
    try {
        require('rest-file-io.conf');
    } catch(error) {
        require(__dirname + '/rest-file-io.conf');
    }
}
var arg1 = process.argv[2] || '';
var arg2 = process.argv[3] || '';
if(arg1 === '--port' && arg2) {
    conf.port = Number(arg2);
}

// globals
var version = 'rest-file-io-2021-05-14';
var app = express();
var fileRe = new RegExp(
    '^/api/1/file/[^/]+'                        // endpoint with verb, such as '/api/1/file/read'
  + '/([a-zA-Z0-9\\_\\-]+)'                     // directory ID, such as '/' + 'tmp'
  + '/([a-zA-Z0-9\\_\\-]+/)*'                   // optional subdirectory path, such as '/' + 'sub/sub-sub/'
  + '([a-zA-Z0-9\\_\\-][a-zA-Z0-9\\_\\-\\.]+)'  // file name, such as 'report.csv'
  + '(\\?.*)?$'                                 // optional URI parameters
);
var listRe = new RegExp(
    '^/api/1/file/list/'                        // endpoint with verb
  + '([a-zA-Z0-9\\_\\-]+)'                      // directory ID, such as 'tmp'
  + '(/[a-zA-Z0-9\\_\\-]+)*'                    // optional subdirectory path, such as '/' + 'sub/sub-sub'
  + '/?(\\?.*)?$'                               // optional URI parameters
);

function getUsage() {
    var usage = [
        'REST File I/O API usage:',
        '- Read file:  GET /api/1/file/read/<directoryID>/<fileName>',
        '  - <directoryID>: Directory ID',
        '  - <fileName>: File name with optional subdirectory path; allowed characters: /, alphanumeric, _, -, .',
        '  - return if ok:    { "data": "....", "error": "" }',
        '  - return if error: { "error": "File <fileName> not found in ID <directoryID>" }',
        '  - optionally add content-type, such as:',
        '    GET /api/1/file/read/tmp/test.txt?contentType=text/plain',
        '  - return if content-type specified: File content, delivered with content-type',
        '- Write file: POST /api/1/file/write/<directoryID>/<fileName>',
        '  - message body is file content, such as CSV for spreadsheet file',
        '  - return if ok:    { "data": "", "error": "" }',
        '  - return if error: { "data": "", "error": "Could not write file <fileName> to directory with ID <directoryID>" }',
        '  - directory must be writable by the rest-file-io application user',
        '- Lock file:       GET /api/1/file/lock/<directoryID>/<fileName>?action=lock',
        '  - return if ok:    { "data": 1, "error": "" }',
        '  - return if error: { "data": 0, "error": "Lock already exists for <fileName>" }',
        '- Unlock file:     GET /api/1/file/lock/<directoryID>/<fileName>?action=unlock',
        '  - return if ok:    { "data": 0, "error": "" }',
        '  - return if error: { "data": 0, "error": "No lock exists for <fileName>" }',
        '- Get lock status: GET /api/1/file/lock/<directoryID>/<fileName>?action=status',
        '  - return if locked:   { "data": 1, "error": "" }',
        '  - return if unlocked: { "data": 0, "error": "" }'
    ];
    if(conf.allowDirList) {
        usage.push('- Query directory IDs:  GET /api/1/file/directories');
        usage.push('  - return: { "data": [ "<id1>", "<id2>" ], "error": "" }');
        usage.push('  - Currently registered directory IDs:');
        usage.push('    ' + Object.keys(conf.directories).sort().join(', '));
    }
    if(conf.allowFileList) {
        usage.push('- Query files in a directory:  GET /api/1/file/list/<directoryID>/<subdirs>');
        usage.push('  - <subdirs>: Optional optional subdirectory path; allowed characters: /, alphanumeric, _, -, .');
        usage.push('  - return: { "data": [ "<file1>", "<file2>]" ], "error": "" }');
    }
    usage.push('- Version: ' + version);
    usage.push('- Documentation and repository: https://github.com/peterthoeny/rest-file-io');
    return usage;
}

function log(msg) {
    var now = new Date();
    var prefix = '- '
        + now.getFullYear() + '-'
        + (now.getMonth() + 1).toString().replace(/^(.)$/, '0$1') + '-'
        + now.getDate().toString().replace(/^(.)$/, '0$1') + '-'
        + now.getHours().toString().replace(/^(.)$/, '0$1') + '-'
        + now.getMinutes().toString().replace(/^(.)$/, '0$1') + ': ';
    console.log(prefix + msg.replace(/\n/g, '\n  '));
}

function sendResponse(url, body, res, contentType) {
    if(contentType) {
        res.set('Content-Type', contentType);
    } else {
        res.contentType('file.json');
        body = JSON.stringify(body, null, '    ');
    }
    log(url + ', ' + JSON.stringify(body).replace(/\\[nr]/g, ' ').replace(/\s+/g, ' ').replace(/^(.{100}).*(.{30})$/, '$1 ... $2'));
    res.send(body);
}

function getDirectoryKey(directoryID, key, fileName) {
    var val = '';
    var dirObj = conf.directories[directoryID];
    if(dirObj && dirObj[key]) {
        var val = dirObj[key]
        if(key === 'path') {
            val = val.replace(/^\.\//, __dirname + '/').replace(/\/$/, '');
            val = val + '/' + fileName;
        }
    }
    return val;
}

app.get('/api/1/file/directories*', function (req, res) {
    var body = {
        data: '',
        error: 'Sorry, directory listing is disabled'
    }
    if(conf.allowDirList) {
        body = {
            data: Object.keys(conf.directories).sort(),
            error: ''
        }
    }
    sendResponse(req.url, body, res);
});

app.get('/api/1/file/list/*', function (req, res) {
    if(!conf.allowFileList) {
        var body = {
            data: '',
            error: 'Sorry, file listing is disabled'
        }
        sendResponse(req.url, body, res);
        return;
    }
    var urlMatch = req.url.match(listRe);
    if(!urlMatch) {
        var body = {
            data: getUsage(),
            error: 'Unrecognized URI: ' + req.url
        }
        sendResponse(req.url, body, res);
        return;
    }
    var directoryID = urlMatch[1];
    var subdirs = urlMatch[2] || '';
    var directoryPath = getDirectoryKey(directoryID, 'path', subdirs).replace(/\/+$/, '');
    if(!directoryPath) {
        var body = {
            data:   '',
            error:  'Unrecognized directory ID'
        }
        if(conf.allowDirList) {
            body.data = 'Available directory IDs: ' + Object.keys(conf.directories).sort().join(', ');
        }
        sendResponse(req.url, body, res);
        return;
    }
    var allowListing = getDirectoryKey(directoryID, 'listing');
    if(!allowListing) {
        var body = {
            data: '',
            error: 'Sorry, file listing is disabled for ' + directoryID
        }
        sendResponse(req.url, body, res);
        return;
    }
    var allowSubdirs = getDirectoryKey(directoryID, 'subdirs');
    if(!allowSubdirs && subdirs) {
        var body = {
            data: '',
            error: 'Sorry, subdirectories are disabled for ' + directoryID
        }
        sendResponse(req.url, body, res);
        return;
    }
    fs.readdir(directoryPath, function (err, files) {
        if(err) {
            var body = {
                error: 'Unable to get content of directory with ID ' + directoryID
            }
            sendResponse(req.url, body, res);
        } else {
            var fileNames = [];
            var pending = 0;
            files.forEach(function(file) {
                if(file.match(/^\./) || file.match(/\.lock$/)) {
                    return;
                }
                pending++;
                fs.stat(directoryPath + '/' + file, function(err, stats) {
                    pending--;
                    if(!err && stats.isFile()) {
                        fileNames.push(file);
                    }
                    if(!pending) {
                        var body = {
                            data:   fileNames.sort(),
                            error:  ''
                        }
                        sendResponse(req.url, body, res);
                    }
                });
            });
        }
    });
});

app.get('/api/1/file/read/*', function (req, res) {
    var urlMatch = req.url.match(fileRe);
    if(!urlMatch) {
        var body = {
            data: getUsage(),
            error: 'Unrecognized URI, or missing/unsupported file name: ' + req.url
        }
        sendResponse(req.url, body, res);
        return;
    }
    var directoryID = urlMatch[1];
    var subdirs = urlMatch[2] || '';
    var fileName = urlMatch[3];
    var filePath = getDirectoryKey(directoryID, 'path', subdirs + fileName);
    if(!filePath) {
        var body = {
            data:   '',
            error:  'Unrecognized directory ID'
        }
        if(conf.allowDirList) {
            body.data = 'Available directory IDs: ' + Object.keys(conf.directories).sort().join(', ');
        }
        sendResponse(req.url, body, res);
        return;
    }
    var allowSubdirs = getDirectoryKey(directoryID, 'subdirs');
    if(!allowSubdirs && subdirs) {
        var body = {
            data: '',
            error: 'Sorry, subdirectories are disabled for ' + directoryID
        }
        sendResponse(req.url, body, res);
        return;
    }
    fs.readFile(filePath, 'utf8', function(err, data) {
        if(err) {
            var body = {
                error: 'File ' + fileName + ' not found with directory ID ' + directoryID
            }
            sendResponse(req.url, body, res);
        } else {
            if(req.query.contentType) {
                sendResponse(req.url, data, res, req.query.contentType);
            } else {
                if(data.match(/^\s*[\{\[][\s\S]*[\}\]]\s*$/)) {
                    try {
                        data = JSON.parse(data);
                    } catch(e) {
                        var body = {
                            data: data,
                            error: e.toString()
                        }
                        sendResponse(req.url, body, res);
                        return;
                    }
                }
                var body = {
                    data:   data,
                    error:  ''
                }
                sendResponse(req.url, body, res);
            }
        }
    });
});

app.post('/api/1/file/write/*', bodyParser.text({ type: '*/*', limit: '50mb' }), function (req, res) {
    var urlMatch = req.url.match(fileRe);
    if(!urlMatch) {
        var body = {
            data: getUsage(),
            error: 'Unrecognized URI, or missing/unsupported file name: ' + req.url
        }
        sendResponse(req.url, body, res);
        return;
    }
    var directoryID = urlMatch[1];
    var subdirs = urlMatch[2] || '';
    var fileName = urlMatch[3];
    var filePath = getDirectoryKey(directoryID, 'path', subdirs + fileName);
    if(!filePath) {
        var body = {
            data:   '',
            error:  'Unrecognized directory ID'
        }
        if(conf.allowDirList) {
            body.data = 'Available directory IDs: ' + Object.keys(conf.directories).sort().join(', ');
        }
        sendResponse(req.url, body, res);
        return;
    }
    var allowSubdirs = getDirectoryKey(directoryID, 'subdirs');
    if(!allowSubdirs && subdirs) {
        var body = {
            data: '',
            error: 'Sorry, subdirectories are disabled for ' + directoryID
        }
        sendResponse(req.url, body, res);
        return;
    }
    var data = req.body;
    fs.writeFile(filePath, data, function(err) {
        var body = {
            data: '',
            error: err ? 'Could not write file ' + fileName + ' to directory with ID ' + directoryID : ''
        }
        sendResponse(req.url, body, res);
    });
});

app.get('/api/1/file/lock/*', function (req, res) {
    var urlMatch = req.url.match(fileRe);
    if(!urlMatch) {
        var body = {
            data: getUsage(),
            error: 'Unrecognized URI, or missing/unsupported file name: ' + req.url
        }
        sendResponse(req.url, body, res);
        return;
    }
    var directoryID = urlMatch[1];
    var subdirs = urlMatch[2] || '';
    var fileName = urlMatch[3];
    var filePath = getDirectoryKey(directoryID, 'path', subdirs + fileName);
    if(!filePath) {
        var body = {
            data:   '',
            error:  'Unrecognized directory ID'
        }
        if(conf.allowDirList) {
            body.data = 'Available directory IDs: ' + Object.keys(conf.directories).sort().join(', ');
        }
        sendResponse(req.url, body, res);
        return;
    }
    var allowSubdirs = getDirectoryKey(directoryID, 'subdirs');
    if(!allowSubdirs && subdirs) {
        var body = {
            data: '',
            error: 'Sorry, subdirectories are disabled for ' + directoryID
        }
        sendResponse(req.url, body, res);
        return;
    }
    var action = req.query.action;
    var lockFile = filePath + '.lock';
    if(action === 'lock') {
        fs.symlink(filePath, lockFile, function(err) {
            if(err) {
                // check age of symlink
                fs.lstat(lockFile, function(err, stats) {
                    if(err) {
                        var body = {
                            data:   0,
                            error:  'Error on existing lock on ' + fileName + ': ' + err
                        }
                        sendResponse(req.url, body, res);
                    } else {
                        var fileTime = new Date(stats.mtime);
                        var now = new Date();
                        var age = parseInt((now.valueOf() - fileTime.valueOf()) / 1000);
                        var lockBreak = Number(conf.lockBreak) || 60;
                        if(age > lockBreak) {
                            // hijack stale lock
                            log('break stale lock for ' + fileName + ', age ' + age + ' > ' + lockBreak + ' sec');
                            fs.unlink(lockFile, function(err, stats) {
                                fs.symlink(filePath, lockFile, function(err) {
                                    var body = {
                                        data:   1,
                                        error:  ''
                                    };
                                    if(err) {
                                        data = 0;
                                        body.error = 'Cannot hijack stale lock for ' + fileName;
                                    }
                                    sendResponse(req.url, body, res);
                                });
                            });
                        } else {
                            // has existing lock, try a few times
                            var lockWait = (Number(conf.lockWait) || 2) * 10;   // unit 1/10 sec
                            function tryLock(waited) {
                                var randomTime = Math.round(Math.random() * (15 - 5)) + 5;
                                setTimeout(function() {
                                    waited += randomTime;
                                    fs.symlink(filePath, lockFile, function(err) {
                                        if(!err) {
                                            // success, we have the lock
                                            waited = Math.round(waited)/10;
                                            log('lock successful for ' + fileName + ' after ' + waited + ' sec wait');
                                            var body = {
                                                data:   1,
                                                error:  ''
                                            }
                                            sendResponse(req.url, body, res);
                                            return;
                                        } else if(waited < lockWait) {
                                            // try again
                                            tryLock(waited);
                                        } else {
                                            // give up
                                            lockWait = Math.round(lockWait)/10;
                                            var msg = 'Cannot get lock for ' + fileName + ' after ' + lockWait + ' sec wait';
                                            log(msg);
                                            var body = {
                                                data:   0,
                                                error:  msg
                                            }
                                            sendResponse(req.url, body, res);
                                        }
                                    });
                                }, randomTime * 100);
                            }
                            tryLock(0);
                        }
                    }
                });
            } else {
                var body = {
                    data:   1,
                    error:  ''
                }
                sendResponse(req.url, body, res);
            }

        });
    } else if(action === 'unlock') {
        fs.unlink(lockFile, function(err, stats) {
            var body = {
                data:   0,
                error:  ''
            }
            if(err) {
                body.data = 0;
                body.error = 'No lock exists for ' + fileName;
            }
            sendResponse(req.url, body, res);
        });
    } else if(action === 'status') {
        fs.stat(lockFile, function(err, stats) {
            var body = {
                data:   err ? 0 : 1,
                error:  ''
            }
            sendResponse(req.url, body, res);
        });
    } else { // help
        var body = {
            data:   'Set parameter action=lock to lock, action=unlock to unlock, action=status to get lock status',
            error:  'Error'
        }
        sendResponse(req.url, body, res);
    }
});

app.get('/favicon.ico', function (req, res) {
    log('/favicon.ico');
    res.sendFile(__dirname + '/public/favicon.ico');
});

app.post('/*', function (req, res) {
    var body = {
        data: getUsage(),
        error: 'Unrecognized URI ' + req.url
    }
    sendResponse(req.url, body, res);
});

app.get('/*', function (req, res) {
    if(req.url === '/') {
        var body = getUsage().join('\n');
        sendResponse(req.url, body, res, 'text/plain');
    } else {
        var body = {
            data: getUsage(),
            error:  'Unrecognized URI ' + req.url
        }
        sendResponse(req.url, body, res);
    }
});

app.listen(conf.port, function () {
    log('rest-file-io app listening on port ' + conf.port);
});

// EOF
