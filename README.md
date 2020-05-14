# REST File I/O

[![GitHub issues](https://img.shields.io/github/issues/peterthoeny/rest-file-io)](https://github.com/peterthoeny/rest-file-io/issues)
[![GitHub stars](https://img.shields.io/github/stars/peterthoeny/rest-file-io)](https://github.com/peterthoeny/rest-file-io/stargazers)
[![GitHub license](https://img.shields.io/github/license/peterthoeny/rest-file-io)](https://github.com/peterthoeny/rest-file-io/blob/master/LICENSE)

rest-file-io is a node.js application to securely read and write files in the file system via a REST API, default port is 8070.

## Getting Started

    $ git clone https://github.com/peterthoeny/rest-file-io.git # or clone your own fork
    $ cd rest-file-io
    $ sudo cp -p rest-file-io.conf /etc
    $ npm install
    $ node rest-file-io

Visit http://localhost:8070/ to access the REST File I/O API.

## REST File I/O API Documentation

The REST File I/O API is mainly intended to be used on an Intranet to automate processes.

For security, only registered directories are available via the REST File I/O API. Directories are available via an ID (symbolic name), which point to the actual directory in the file system. Define the list of directory IDs in the `rest-file-io.conf.directories` setting. Example setting:

    directories: {
        example:    '/file/path/to/example',    // fix/add as needed
        tmp:        './public/tmp'              // local rest-file-io directory for testing
    },

Modify the list of directory IDs in `rest-file-io.conf` located in `/etc` or the rest-file-io application directory. The referenced directories must be readable/writable by the rest-file-io application user.

### Read File

- Endpoint: `GET /api/1/file/read/<directoryID>/<fileName>`
  - `<directoryID>`: Directory ID
  - `<fileName>`: File name; allowed characters: Alphanumeric, _, -, .
  - Example: http://localhost:8070/api/1/file/read/tmp/test.csv
- Return:
  - If ok: `{ "data": "<content>", "error": "" }`
  - If error: `{ "error": "File <fileName> not found in ID <directoryID>" }`
- Optionally add a content-type:
  - Endpoint: `GET /api/1/file/read/tmp/test.txt?contentType=text/plain`
  - Example: http://localhost:8070/api/1/file/read/tmp/test.csv?contentType=text/plain
  - Return: File content, delivered with specified content-type

### Write File

- Endpoint: `POST /api/1/file/write/<directoryID>/<fileName>`
  - Message body is file content, such as CSV data of a spreadsheet file
  - Directory must be writable by application user
- Return:
  - If ok:    `{ "data": "", "error": "" }`
  - If error: `{ "data": "", "error": "Could not write file <fileName> to directory with ID <directoryID>" }`

### File Locking

- Lock file endpoint: `GET /api/1/file/lock/<directoryID>/<fileName>?action=lock`
  - Example: http://localhost:8070/api/1/file/lock/tmp/test.csv?action=lock
  - return if ok:    `{ "data": 1, "error": "" }`
  - return if error: `{ "data": 0, "error": "Lock already exists for <fileName>" }`
  - In case there is a existing stale lock: Break lock if it is older than defined in `rest-file-io.conf.lockBreak` setting, default 60 sec
  - In case there is a existing valid lock: Wait up to the time defined in `rest-file-io.conf.lockWait` setting, default 2.5 sec; an error is returned if not able to acquire a lock within that time
- Unlock file endpoint: `GET /api/1/file/lock/<directoryID>/<fileName>?action=unlock`
  - Example: http://localhost:8070/api/1/file/lock/tmp/test.csv?action=unlock
  - return if ok:    `{ "data": 0, "error": "" }`
  - return if error: `{ "data": 0, "error": "No lock exists for <fileName>" }`
- Get lock status endpoint: `GET /api/1/file/lock/<directoryID>/<fileName>?action=status`
  - Example: http://localhost:8070/api/1/file/lock/tmp/test.csv?action=status
  - return if locked:   `{ "data": 1, "error": "" }`
  - return if unlocked: `{ "data": 0, "error": "" }`

### List Directory IDs

- Endpoint: `GET /api/1/file/directories`
  - Return: `{ "data": [ "<id1>", "<id2>" ], "error": "" }`
  - Example: http://localhost:8070/api/1/file/directories
  - Available only if enabled with `rest-file-io.conf.allowDirList` setting

### List Files in a Directory

- Endpoint: `GET /api/1/file/list/<directoryID>/files`
  - return: `{ "data": [ "<file1>", "<file2>]" ], "error": "" }`
  - Example: http://localhost:8070/api/1/file/list/tmp/files
  - Available only if enabled with `rest-file-io.conf.allowFileList` setting

## Package Files

- `rest-file-io.conf` - REST File I/O configuration template, copy to /etc and modify
- `rest-file-io.js` - REST File I/O application
- `public/favicon.ico` - favicon in case the API is used from a browser
- `public/tmp/test.csv` - test CSV file to read & write
- `public/tmp/test.txt` - test text file to read & write

// EOF
