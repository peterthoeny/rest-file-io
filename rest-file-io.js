// rest-file-io.js: REST File I/O API to securely read and write files in the file system
// Version:   1.1.1
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
const arg1 = process.argv[2] || '';
const arg2 = process.argv[3] || '';
if(arg1 === '--port' && arg2) {
    conf.port = Number(arg2);
}

// globals
const version = 'rest-file-io-2021-05-14';
const app = express();
const fileRe = new RegExp(
    '^/api/1/file/[^/]+'                        // endpoint with verb, such as '/api/1/file/read'
  + '/([a-zA-Z0-9\\_\\-]+)'                     // directory ID, such as '/' + 'tmp'
  + '/([a-zA-Z0-9\\_\\-]+/)*'                   // optional subdirectory path, such as '/' + 'sub/sub-sub/'
  + '([a-zA-Z0-9\\_\\-][a-zA-Z0-9\\_\\-\\.]+)'  // file name, such as 'report.csv'
  + '(\\?.*)?$'                                 // optional URI parameters
);
const listRe = new RegExp(
    '^/api/1/file/list/'                        // endpoint with verb
  + '([a-zA-Z0-9\\_\\-]+)'                      // directory ID, such as 'tmp'
  + '(/[a-zA-Z0-9\\_\\-]+)*'                    // optional subdirectory path, such as '/' + 'sub/sub-sub'
  + '/?(\\?.*)?$'                               // optional URI parameters
);

process.on('uncaughtException', (err) => {
    log('rest-file-io app caught exception: ' + err);
    process.exit();
});

['SIGINT', 'SIGTERM', 'SIGQUIT'].forEach(signal => process.on(signal, () => {
    log('rest-file-io app terminates with ' + signal);
    process.exit();
}));

process.on('exit', () => {
    log('rest-file-io app exit');
});

function getUsage() {
    let usage = [
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

function log(msg, dontShorten) {
    const now = new Date();
    const prefix = '- '
        + now.getFullYear() + '-'
        + (now.getMonth() + 1).toString().replace(/^(.)$/, '0$1') + '-'
        + now.getDate().toString().replace(/^(.)$/, '0$1') + '-'
        + now.getHours().toString().replace(/^(.)$/, '0$1') + '-'
        + now.getMinutes().toString().replace(/^(.)$/, '0$1') + ': ';
    if(msg.length > 640 && !dontShorten) {
        // don't use .replace(/^(.{512}).*(.{128})$/, '$1 .......... $2') due to performance
        msg = msg.substring(0, 511) + ' ......... ' + msg.substring(msg.length - 128);
    }
    console.log(prefix + msg.replace(/\s+/g, ' '));
}

function sendResponse(url, body, res, contentType) {
    if(contentType) {
        res.set('Content-Type', contentType);
    } else {
        res.contentType('file.json');
        body = JSON.stringify(body, null, '  ');
    }
    log(url + ', ' + (typeof body === 'string' ? body : JSON.stringify(body)));
    res.send(body);
}

function getDirectoryKey(directoryID, key, fileName) {
    let val = '';
    const dirObj = conf.directories[directoryID];
    if(dirObj && dirObj[key]) {
        val = dirObj[key];
        if(key === 'path') {
            val = val.replace(/^\.\//, __dirname + '/').replace(/\/$/, '');
            val = val + '/' + fileName;
        }
    }
    return val;
}

app.get('/api/1/file/directories*', function (req, res) {
    let body = {
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
        const body = {
            data: '',
            error: 'Sorry, file listing is disabled'
        }
        sendResponse(req.url, body, res);
        return;
    }
    const urlMatch = req.url.match(listRe);
    if(!urlMatch) {
        const body = {
            data: getUsage(),
            error: 'Unrecognized URI: ' + req.url
        }
        sendResponse(req.url, body, res);
        return;
    }
    const directoryID = urlMatch[1];
    const subdirs = urlMatch[2] || '';
    const directoryPath = getDirectoryKey(directoryID, 'path', subdirs).replace(/\/+$/, '');
    if(!directoryPath) {
        const body = {
            data:   '',
            error:  'Unrecognized directory ID'
        }
        if(conf.allowDirList) {
            body.data = 'Available directory IDs: ' + Object.keys(conf.directories).sort().join(', ');
        }
        sendResponse(req.url, body, res);
        return;
    }
    const allowListing = getDirectoryKey(directoryID, 'listing');
    if(!allowListing) {
        const body = {
            data: '',
            error: 'Sorry, file listing is disabled for ' + directoryID
        }
        sendResponse(req.url, body, res);
        return;
    }
    const allowSubdirs = getDirectoryKey(directoryID, 'subdirs');
    if(!allowSubdirs && subdirs) {
        const body = {
            data: '',
            error: 'Sorry, subdirectories are disabled for ' + directoryID
        }
        sendResponse(req.url, body, res);
        return;
    }
    fs.readdir(directoryPath, function (err, files) {
        if(err) {
            const body = {
                error: 'Unable to get content of directory with ID ' + directoryID
            }
            sendResponse(req.url, body, res);
        } else {
            let fileNames = [];
            let pending = 0;
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
                        const body = {
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
    const urlMatch = req.url.match(fileRe);
    if(!urlMatch) {
        const body = {
            data: getUsage(),
            error: 'Unrecognized URI, or missing/unsupported file name: ' + req.url
        }
        sendResponse(req.url, body, res);
        return;
    }
    const directoryID = urlMatch[1];
    const subdirs = urlMatch[2] || '';
    const fileName = urlMatch[3];
    const filePath = getDirectoryKey(directoryID, 'path', subdirs + fileName);
    if(!filePath) {
        const body = {
            data:   '',
            error:  'Unrecognized directory ID'
        }
        if(conf.allowDirList) {
            body.data = 'Available directory IDs: ' + Object.keys(conf.directories).sort().join(', ');
        }
        sendResponse(req.url, body, res);
        return;
    }
    const allowSubdirs = getDirectoryKey(directoryID, 'subdirs');
    if(!allowSubdirs && subdirs) {
        const body = {
            data: '',
            error: 'Sorry, subdirectories are disabled for ' + directoryID
        }
        sendResponse(req.url, body, res);
        return;
    }
    fs.readFile(filePath, 'utf8', function(err, data) {
        if(err) {
            const body = {
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
                        const body = {
                            data: data,
                            error: e.toString()
                        }
                        sendResponse(req.url, body, res);
                        return;
                    }
                }
                const body = {
                    data:   data,
                    error:  ''
                }
                sendResponse(req.url, body, res);
            }
        }
    });
});

app.post('/api/1/file/write/*', bodyParser.text({ type: '*/*', limit: '50mb' }), function (req, res) {
    const urlMatch = req.url.match(fileRe);
    if(!urlMatch) {
        const body = {
            data: getUsage(),
            error: 'Unrecognized URI, or missing/unsupported file name: ' + req.url
        }
        sendResponse(req.url, body, res);
        return;
    }
    const directoryID = urlMatch[1];
    const subdirs = urlMatch[2] || '';
    const fileName = urlMatch[3];
    const filePath = getDirectoryKey(directoryID, 'path', subdirs + fileName);
    if(!filePath) {
        const body = {
            data:   '',
            error:  'Unrecognized directory ID'
        }
        if(conf.allowDirList) {
            body.data = 'Available directory IDs: ' + Object.keys(conf.directories).sort().join(', ');
        }
        sendResponse(req.url, body, res);
        return;
    }
    const allowSubdirs = getDirectoryKey(directoryID, 'subdirs');
    if(!allowSubdirs && subdirs) {
        const body = {
            data: '',
            error: 'Sorry, subdirectories are disabled for ' + directoryID
        }
        sendResponse(req.url, body, res);
        return;
    }
    const data = req.body;
    fs.writeFile(filePath, data, function(err) {
        const body = {
            data: '',
            error: err ? 'Could not write file ' + fileName + ' to directory with ID ' + directoryID : ''
        }
        sendResponse(req.url, body, res);
    });
});

app.get('/api/1/file/lock/*', function (req, res) {
    const urlMatch = req.url.match(fileRe);
    if(!urlMatch) {
        const body = {
            data: getUsage(),
            error: 'Unrecognized URI, or missing/unsupported file name: ' + req.url
        }
        sendResponse(req.url, body, res);
        return;
    }
    const directoryID = urlMatch[1];
    const subdirs = urlMatch[2] || '';
    const fileName = urlMatch[3];
    const filePath = getDirectoryKey(directoryID, 'path', subdirs + fileName);
    if(!filePath) {
        const body = {
            data:   '',
            error:  'Unrecognized directory ID'
        }
        if(conf.allowDirList) {
            body.data = 'Available directory IDs: ' + Object.keys(conf.directories).sort().join(', ');
        }
        sendResponse(req.url, body, res);
        return;
    }
    const allowSubdirs = getDirectoryKey(directoryID, 'subdirs');
    if(!allowSubdirs && subdirs) {
        const body = {
            data: '',
            error: 'Sorry, subdirectories are disabled for ' + directoryID
        }
        sendResponse(req.url, body, res);
        return;
    }
    const action = req.query.action;
    const lockFile = filePath + '.lock';
    if(action === 'lock') {
        fs.symlink(filePath, lockFile, function(err) {
            if(err) {
                // check age of symlink
                fs.lstat(lockFile, function(err, stats) {
                    if(err) {
                        const body = {
                            data:   0,
                            error:  'Error on existing lock on ' + fileName + ': ' + err
                        }
                        sendResponse(req.url, body, res);
                    } else {
                        const fileTime = new Date(stats.mtime);
                        const now = new Date();
                        const age = parseInt((now.valueOf() - fileTime.valueOf()) / 1000);
                        const lockBreak = Number(conf.lockBreak) || 60;
                        if(age > lockBreak) {
                            // hijack stale lock
                            log('break stale lock for ' + fileName + ', age ' + age + ' > ' + lockBreak + ' sec');
                            fs.unlink(lockFile, function(err, stats) {
                                fs.symlink(filePath, lockFile, function(err) {
                                    const body = {
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
                            let lockWait = (Number(conf.lockWait) || 2) * 10;   // unit 1/10 sec
                            function tryLock(waited) {
                                const randomTime = Math.round(Math.random() * (15 - 5)) + 5;
                                setTimeout(function() {
                                    waited += randomTime;
                                    fs.symlink(filePath, lockFile, function(err) {
                                        if(!err) {
                                            // success, we have the lock
                                            waited = Math.round(waited)/10;
                                            log('lock successful for ' + fileName + ' after ' + waited + ' sec wait');
                                            const body = {
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
                                            const msg = 'Cannot get lock for ' + fileName + ' after ' + lockWait + ' sec wait';
                                            log(msg);
                                            const body = {
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
                const body = {
                    data:   1,
                    error:  ''
                }
                sendResponse(req.url, body, res);
            }

        });
    } else if(action === 'unlock') {
        fs.unlink(lockFile, function(err, stats) {
            const body = {
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
            const body = {
                data:   err ? 0 : 1,
                error:  ''
            }
            sendResponse(req.url, body, res);
        });
    } else { // help
        const body = {
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
    const body = {
        data: getUsage(),
        error: 'Unrecognized URI ' + req.url
    }
    sendResponse(req.url, body, res);
});

app.get('/*', function (req, res) {
    if(req.url === '/') {
        const body = getUsage().join('\n');
        sendResponse(req.url, body, res, 'text/plain');
    } else {
        const body = {
            data: getUsage(),
            error:  'Unrecognized URI ' + req.url
        }
        sendResponse(req.url, body, res);
    }
});

app.listen(conf.port, function () {
    log('rest-file-io app start, listening on port ' + conf.port);
});

// EOF
