# REST File I/O

[![GitHub issues](https://img.shields.io/github/issues/peterthoeny/rest-file-io)](https://github.com/peterthoeny/rest-file-io/issues)
[![GitHub stars](https://img.shields.io/github/stars/peterthoeny/rest-file-io)](https://github.com/peterthoeny/rest-file-io/stargazers)
[![GitHub license](https://img.shields.io/github/license/peterthoeny/rest-file-io)](https://github.com/peterthoeny/rest-file-io/blob/master/LICENSE)

REST File I/O (rest-file-io) is a node.js application to read and write files in the
file system securely via a REST API. Default port: 8070.

 * Base URL & help: http://localhost:8070/
 * Sample file: http://localhost:8070/api/1/file/read/tmp/test.txt?contentType=text/plain

Files:

 * rest-file-io.conf - REST File I/O configuration template, copy to /etc
 * rest-file-io.js - REST File I/O application
 * public/favicon.ico - favicon in case the API is used from a browser
 * public/tmp/test.txt - sample text file to read & write

// EOF
