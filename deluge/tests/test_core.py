# -*- coding: utf-8 -*-
#
# This file is part of Deluge and is licensed under GNU General Public License 3.0, or later, with
# the additional special exception to link portions of this program with the OpenSSL library.
# See LICENSE for more details.
#

from __future__ import unicode_literals

import base64
from hashlib import sha1 as sha

import pytest
from twisted.internet import defer, reactor
from twisted.internet.error import CannotListenError
from twisted.python.failure import Failure
from twisted.web.http import FORBIDDEN
from twisted.web.resource import Resource
from twisted.web.server import Site
from twisted.web.static import File

import deluge.common
import deluge.component as component
import deluge.core.torrent
from deluge.common import PY2
from deluge.core.core import Core
from deluge.core.rpcserver import RPCServer
from deluge.error import AddTorrentError, InvalidTorrentError
from deluge.ui.web.common import compress

from . import common
from .basetest import BaseTestCase

common.disable_new_release_check()


class CookieResource(Resource):

    def render(self, request):
        if request.getCookie('password') != 'deluge':
            request.setResponseCode(FORBIDDEN)
            return

        request.setHeader(b'Content-Type', b'application/x-bittorrent')
        with open(common.get_test_data_file('ubuntu-9.04-desktop-i386.iso.torrent'), 'rb') as _file:
            data = _file.read()
        return data


class PartialDownload(Resource):

    def render(self, request):
        with open(common.get_test_data_file('ubuntu-9.04-desktop-i386.iso.torrent'), 'rb') as _file:
            data = _file.read()
        request.setHeader(b'Content-Type', len(data))
        request.setHeader(b'Content-Type', b'application/x-bittorrent')
        if request.requestHeaders.hasHeader('accept-encoding'):
            return compress(data, request)
        return data


class RedirectResource(Resource):

    def render(self, request):
        request.redirect(b'/ubuntu-9.04-desktop-i386.iso.torrent')
        return b''


class TopLevelResource(Resource):

    addSlash = True

    def __init__(self):
        Resource.__init__(self)
        self.putChild('cookie', CookieResource())
        self.putChild('partial', PartialDownload())
        self.putChild('redirect', RedirectResource())
        self.putChild('ubuntu-9.04-desktop-i386.iso.torrent',
                      File(common.get_test_data_file('ubuntu-9.04-desktop-i386.iso.torrent')))


class CoreTestCase(BaseTestCase):

    def set_up(self):
        common.set_tmp_config_dir()
        self.rpcserver = RPCServer(listen=False)
        self.core = Core()
        self.listen_port = 51242
        return component.start().addCallback(self.start_web_server)

    def start_web_server(self, result):
        website = Site(TopLevelResource())
        for dummy in range(10):
            try:
                self.webserver = reactor.listenTCP(self.listen_port, website)
            except CannotListenError as ex:
                error = ex
                self.listen_port += 1
            else:
                break
        else:
            raise error

        return result

    def tear_down(self):

        def on_shutdown(result):
            del self.rpcserver
            del self.core
            return self.webserver.stopListening()

        return component.shutdown().addCallback(on_shutdown)

    @defer.inlineCallbacks
    def test_add_torrent_files(self):
        options = {}
        filenames = ['test.torrent', 'test_torrent.file.torrent']
        files_to_add = []
        for f in filenames:
            filename = common.get_test_data_file(f)
            with open(filename, 'rb') as _file:
                filedump = base64.encodestring(_file.read())
            files_to_add.append((filename, filedump, options))
        errors = yield self.core.add_torrent_files(files_to_add)
        self.assertEqual(len(errors), 0)

    @defer.inlineCallbacks
    def test_add_torrent_files_error_duplicate(self):
        options = {}
        filenames = ['test.torrent', 'test.torrent']
        files_to_add = []
        for f in filenames:
            filename = common.get_test_data_file(f)
            with open(filename, 'rb') as _file:
                filedump = base64.encodestring(_file.read())
            files_to_add.append((filename, filedump, options))
        errors = yield self.core.add_torrent_files(files_to_add)
        self.assertEqual(len(errors), 1)
        self.assertTrue(str(errors[0]).startswith('Torrent already in session'))

    @defer.inlineCallbacks
    def test_add_torrent_file(self):
        options = {}
        filename = common.get_test_data_file('test.torrent')
        with open(filename, 'rb') as _file:
            filedump = base64.encodestring(_file.read())
        torrent_id = yield self.core.add_torrent_file_async(filename, filedump, options)

        # Get the info hash from the test.torrent
        from deluge.bencode import bdecode, bencode
        with open(filename, 'rb') as _file:
            info_hash = sha(bencode(bdecode(_file.read())[b'info'])).hexdigest()
        self.assertEquals(torrent_id, info_hash)

    def test_add_torrent_file_invalid_filedump(self):
        options = {}
        filename = common.get_test_data_file('test.torrent')
        self.assertRaises(AddTorrentError, self.core.add_torrent_file, filename, False, options)

    @defer.inlineCallbacks
    def test_add_torrent_url(self):
        url = 'http://localhost:%d/ubuntu-9.04-desktop-i386.iso.torrent' % self.listen_port
        options = {}
        info_hash = '60d5d82328b4547511fdeac9bf4d0112daa0ce00'

        torrent_id = yield self.core.add_torrent_url(url, options)
        self.assertEqual(torrent_id, info_hash)

    def test_add_torrent_url_with_cookie(self):
        url = 'http://localhost:%d/cookie' % self.listen_port
        options = {}
        headers = {'Cookie': 'password=deluge'}
        info_hash = '60d5d82328b4547511fdeac9bf4d0112daa0ce00'

        d = self.core.add_torrent_url(url, options)
        d.addCallbacks(self.fail, self.assertIsInstance, errbackArgs=(Failure,))

        d = self.core.add_torrent_url(url, options, headers)
        d.addCallbacks(self.assertEqual, self.fail, callbackArgs=(info_hash,))

        return d

    def test_add_torrent_url_with_redirect(self):
        url = 'http://localhost:%d/redirect' % self.listen_port
        options = {}
        info_hash = '60d5d82328b4547511fdeac9bf4d0112daa0ce00'

        d = self.core.add_torrent_url(url, options)
        d.addCallback(self.assertEqual, info_hash)
        return d

    def test_add_torrent_url_with_partial_download(self):
        url = 'http://localhost:%d/partial' % self.listen_port
        options = {}
        info_hash = '60d5d82328b4547511fdeac9bf4d0112daa0ce00'

        d = self.core.add_torrent_url(url, options)
        d.addCallback(self.assertEqual, info_hash)
        return d

    @defer.inlineCallbacks
    def test_add_torrent_magnet(self):
        info_hash = '60d5d82328b4547511fdeac9bf4d0112daa0ce00'
        uri = deluge.common.create_magnet_uri(info_hash)
        options = {}
        torrent_id = yield self.core.add_torrent_magnet(uri, options)
        self.assertEqual(torrent_id, info_hash)

    @defer.inlineCallbacks
    def test_remove_torrent(self):
        options = {}
        filename = common.get_test_data_file('test.torrent')
        with open(filename, 'rb') as _file:
            filedump = base64.encodestring(_file.read())
        torrent_id = yield self.core.add_torrent_file_async(filename, filedump, options)
        removed = self.core.remove_torrent(torrent_id, True)
        self.assertTrue(removed)
        self.assertEqual(len(self.core.get_session_state()), 0)

    def test_remove_torrent_invalid(self):
        self.assertRaises(InvalidTorrentError, self.core.remove_torrent, 'torrentidthatdoesntexist', True)

    @defer.inlineCallbacks
    def test_remove_torrents(self):
        options = {}
        filename = common.get_test_data_file('test.torrent')
        with open(filename, 'rb') as _file:
            filedump = base64.encodestring(_file.read())
        torrent_id = yield self.core.add_torrent_file_async(filename, filedump, options)

        filename2 = common.get_test_data_file('unicode_filenames.torrent')
        with open(filename2, 'rb') as _file:
            filedump = base64.encodestring(_file.read())
        torrent_id2 = yield self.core.add_torrent_file_async(filename2, filedump, options)
        d = self.core.remove_torrents([torrent_id, torrent_id2], True)

        def test_ret(val):
            self.assertTrue(val == [])
        d.addCallback(test_ret)

        def test_session_state(val):
            self.assertEqual(len(self.core.get_session_state()), 0)
        d.addCallback(test_session_state)
        yield d

    @defer.inlineCallbacks
    def test_remove_torrents_invalid(self):
        options = {}
        filename = common.get_test_data_file('test.torrent')
        with open(filename, 'rb') as _file:
            filedump = base64.encodestring(_file.read())
            torrent_id = yield self.core.add_torrent_file_async(filename, filedump, options)
        val = yield self.core.remove_torrents(['invalidid1', 'invalidid2', torrent_id], False)
        self.assertEqual(len(val), 2)
        self.assertEqual(val[0], ('invalidid1', 'torrent_id invalidid1 not in session.'))
        self.assertEqual(val[1], ('invalidid2', 'torrent_id invalidid2 not in session.'))

    def test_get_session_status(self):
        status = self.core.get_session_status(['upload_rate', 'download_rate'])
        self.assertEqual(type(status), dict)
        self.assertEqual(status['upload_rate'], 0.0)

    def test_get_session_status_ratio(self):
        status = self.core.get_session_status(['write_hit_ratio', 'read_hit_ratio'])
        self.assertEqual(type(status), dict)
        self.assertEqual(status['write_hit_ratio'], 0.0)
        self.assertEqual(status['read_hit_ratio'], 0.0)

    def test_get_free_space(self):
        space = self.core.get_free_space('.')
        # get_free_space returns long on Python 2 (32-bit).
        self.assertTrue(isinstance(space, int if not PY2 else (int, long)))
        self.assertTrue(space >= 0)
        self.assertEqual(self.core.get_free_space('/someinvalidpath'), -1)

    @pytest.mark.slow
    def test_test_listen_port(self):
        d = self.core.test_listen_port()

        def result(r):
            self.assertTrue(r in (True, False))

        d.addCallback(result)
        return d

    def test_sanitize_filepath(self):
        pathlist = {
            '\\backslash\\path\\': 'backslash/path',
            ' single_file ': 'single_file',
            '..': '',
            '/../..../': '',
            '  Def ////ad./ / . . /b  d /file': 'Def/ad./. ./b  d/file',
            '/ test /\\.. /.file/': 'test/.file',
            'mytorrent/subfold/file1': 'mytorrent/subfold/file1',
            'Torrent/folder/': 'Torrent/folder',
        }

        for key in pathlist:
            self.assertEqual(deluge.core.torrent.sanitize_filepath(key, folder=False), pathlist[key])
            self.assertEqual(deluge.core.torrent.sanitize_filepath(key, folder=True), pathlist[key] + '/')

    def test_get_set_config_values(self):
        self.assertEqual(self.core.get_config_values(['abc', 'foo']), {'foo': None, 'abc': None})
        self.assertEqual(self.core.get_config_value('foobar'), None)
        self.core.set_config({'abc': 'def', 'foo': 10, 'foobar': 'barfoo'})
        self.assertEqual(self.core.get_config_values(['foo', 'abc']), {'foo': 10, 'abc': 'def'})
        self.assertEqual(self.core.get_config_value('foobar'), 'barfoo')

    def test_read_only_config_keys(self):
        key = 'max_upload_speed'
        self.core.read_only_config_keys = [key]

        old_value = self.core.get_config_value(key)
        self.core.set_config({key: old_value + 10})
        new_value = self.core.get_config_value(key)
        self.assertEqual(old_value, new_value)

        self.core.read_only_config_keys = None
