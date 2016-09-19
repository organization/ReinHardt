'use strict';

module.exports.create = function(conf) {
    var port = conf.port || 53;
    var address4 = conf.address4 || '0.0.0.0';
    var getAnswerList = conf.getAnswerList;
    var ndns = require('native-dns');
    var recordStore;
    var handler;
    var tcpserver;
    var udpserver;

    recordStore = {
        getAnswerList: getAnswerList
    };

    handler = require('./ddns-handler.js').create(ndns, conf, recordStore);

    function onError(err, msg, response) {
        console.error('[onError] packet could not be unpacked');
        console.error(msg);
        console.error(err && err.stack || err || "Unknown Error");
        if (response && response.send) {
            response.send();
        }
    }

    function onSocketError(err, socket) {
        console.error('[onSocketError]');
        console.error(socket);
        console.error(err && err.stack || err || "Unknown Error");
        if (socket && socket.destroy) {
            // ??
            socket.destroy();
        }
    }

    function onRequestError(err, request, response) {
        console.error('[onRequestError] application logic failed');
        console.error(err && err.stack || err || "Unknown Error");
        if (request && request.question) {
            // this should always happen
            console.error(request.question);
        } else {
            // this should never happen
            console.error(request);
        }
        try {
            if (response && response.send) {
                response.send();
            }
        } catch (e) {
            // ignore
            return;
        }
    }

    function onRequest(request, response) {
        try {
            handler(request, response);
        } catch (e) {
            onRequestError(e, request, response);
        }
    }

    function createServer(server) {
        if (!server) {
            return null;
        }

        try {
            server.on('error', onError);
            server.on('socketError', onSocketError);
            server.on('request', onRequest);
        } catch (e) {
            console.error('[Create Server] Failed to create server');
            console.error(e.stack);
            return null;
        }

        return server;
    }

    function closeServer(server, onClose) {
        if (!server) {
            return null;
        }

        try {
            server.on('close', onClose);
            server.close();
        } catch (e) {
            console.error('[Server Close] Failed to close server');
            console.error(e.stack);
            return onClose(e);
        }
    }

    function close() {
        var PromiseA = require('bluebird');

        return new PromiseA(function(resolve, reject) {
            var count = 0;

            function onClose(e) {
                if (e) {
                    reject(e);
                    return;
                }

                count += 1;
                if (count > 1) {
                    resolve();
                }
            }

            closeServer(udpserver, onClose);
            closeServer(tcpserver, onClose);

            tcpserver = null;
            udpserver = null;
        });
    }

    function listen() {
        var PromiseA = require('bluebird');

        close();

        udpserver = createServer(ndns.createServer());
        tcpserver = createServer(ndns.createTCPServer());

        return new PromiseA(function(resolve, reject) {
            var count = 0;

            function onListening(err) {
                //console.log('dns listening', self.option.port, self.option.host);
                count += 1;
                if (count > 1) {
                    if (err) {
                        close();
                        reject(err);
                    } else {
                        resolve({
                            close: close
                        });
                    }
                }
            }

            udpserver.on('listening', onListening);
            tcpserver.on('listening', onListening);

            udpserver.serve(port, address4);
            tcpserver.serve(port, address4);
        });
    }

    return {
        listen: listen,
        close: close,
        onError: onError,
        onSocketError: onSocketError,
        onRequest: onRequest
    };
};
