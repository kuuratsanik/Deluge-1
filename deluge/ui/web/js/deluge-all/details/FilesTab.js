/*!
 * Deluge.details.FilesTab.js
 *
 * Copyright (c) Damien Churchill 2009-2011 <damoxc@gmail.com>
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 3, or (at your option)
 * any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, write to:
 *     The Free Software Foundation, Inc.,
 *     51 Franklin Street, Fifth Floor
 *     Boston, MA  02110-1301, USA.
 *
 * In addition, as a special exception, the copyright holders give
 * permission to link the code of portions of this program with the OpenSSL
 * library.
 * You must obey the GNU General Public License in all respects for all of
 * the code used other than OpenSSL. If you modify file(s) with this
 * exception, you may extend this exception to your version of the file(s),
 * but you are not obligated to do so. If you do not wish to do so, delete
 * this exception statement from your version. If you delete this exception
 * statement from all source files in the program, then also delete it here.
 */

Ext.define('Deluge.data.File', {
    extend: 'Ext.data.Model',
    fields: [
        {name: 'filename', type: 'string'},
        {name: 'size',     type: 'int'},
        {name: 'progress', type: 'float'}
    ]
});

Ext.define('Deluge.details.FilesTab', {

    extend: 'Ext.tree.Panel',

    title: _('Files'),

    rootVisible: false,

    columns: [{
        header: _('Filename'),
        width: 330,
        dataIndex: 'filename'
    }, {
        header: _('Size'),
        width: 150,
        dataIndex: 'size',
        tpl: Ext.create('Ext.XTemplate', '{size:this.fsize}', {
            fsize: function(v) { return fsize(v); }
        })
    }, {
        header: _('Progress'),
        width: 150,
        dataIndex: 'progress',
        tpl: Ext.create('Ext.XTemplate', '{progress:this.progress}', {
            progress: function(v) {
                var progress = v * 100;
                return Deluge.progressBar(progress, this.col.width, progress.toFixed(2) + '%', 0);
            }
        })
    }, {
        header: _('Priority'),
        width: 150,
        dataIndex: 'priority',
        tpl: new Ext.XTemplate('<tpl if="!isNaN(priority)">' +
            '<div class="{priority:this.getClass}">' +
                '{priority:this.getName}' +
            '</div></tpl>', {
            getClass: function(v) {
                return FILE_PRIORITY_CSS[v];
            },

            getName: function(v) {
                return _(FILE_PRIORITY[v]);
            }
        })
    }],

    multiSelect: true,

    clear: function() {
        var root = this.getRootNode();
        if (!root.hasChildNodes()) return;
        root.cascade(function(node) {
            var parentNode = node.parentNode;
            if (!parentNode) return;
            if (!parentNode.ownerTree) return;
            parentNode.removeChild(node);
        });
    },

    createFileTree: function(files) {
        function walk(files, parentNode) {
            for (var file in files.contents) {
                var item = files.contents[file];
                if (item.type == 'dir') {
                    walk(item, parentNode.appendChild(new Ext.tree.TreeNode({
                        text: file,
                        filename: file,
                        size: item.size,
                        progress: item.progress,
                        priority: item.priority
                    })));
                } else {
                    parentNode.appendChild(new Ext.tree.TreeNode({
                        text: file,
                        filename: file,
                        fileIndex: item.index,
                        size: item.size,
                        progress: item.progress,
                        priority: item.priority,
                        leaf: true,
                        iconCls: 'x-deluge-file',
                        uiProvider: Ext.ux.tree.TreeGridNodeUI
                    }));
                }
            }
        }
        var root = this.getRootNode();
        walk(files, root);
        root.firstChild.expand();
    },

    update: function(torrentId) {
        if (this.torrentId != torrentId) {
            this.clear();
            this.torrentId = torrentId;
        }

        deluge.client.web.get_torrent_files(torrentId, {
            success: this.onRequestComplete,
            scope: this,
            torrentId: torrentId
        });
    },

    updateFileTree: function(files) {
        function walk(files, parentNode) {
            for (var file in files.contents) {
                var item = files.contents[file];
                var node = parentNode.findChild('filename', file);
                node.attributes.size     = item.size;
                node.attributes.progress = item.progress;
                node.attributes.priority = item.priority;
                node.ui.updateColumns();
                if (item.type == 'dir') {
                    walk(item, node);
                }
            }
        }
        walk(files, this.getRootNode());
    },

    onRender: function(ct, position) {
        Deluge.details.FilesTab.superclass.onRender.call(this, ct, position);
        deluge.menus.filePriorities.on('itemclick', this.onItemClick, this);
        this.on('contextmenu', this.onContextMenu, this);
        this.sorter = new Ext.tree.TreeSorter(this, {
            folderSort: true
        });
    },

    onContextMenu: function(node, e) {
        e.stopEvent();
        var selModel = this.getSelectionModel();
        if (selModel.getSelectedNodes().length < 2) {
            selModel.clearSelections();
            node.select();
        }
        deluge.menus.filePriorities.showAt(e.getPoint());
    },

    onItemClick: function(baseItem, e) {
        switch (baseItem.id) {
            case 'expandAll':
                this.expandAll();
                break;
            default:
                var indexes = {};
                function walk(node) {
                    if (Ext.isEmpty(node.attributes.fileIndex)) return;
                    indexes[node.attributes.fileIndex] = node.attributes.priority;
                }
                this.getRootNode().cascade(walk);

                var nodes = this.getSelectionModel().getSelectedNodes();
                Ext.each(nodes, function(node) {
                    if (!node.isLeaf()) {
                        function setPriorities(node) {
                            if (Ext.isEmpty(node.attributes.fileIndex)) return;
                            indexes[node.attributes.fileIndex] = baseItem.filePriority;
                        }
                        node.cascade(setPriorities);
                    } else if (!Ext.isEmpty(node.attributes.fileIndex)) {
                        indexes[node.attributes.fileIndex] = baseItem.filePriority;
                        return;
                    }
                });

                var priorities = new Array(Ext.keys(indexes).length);
                for (var index in indexes) {
                    priorities[index] = indexes[index];
                }

                deluge.client.core.set_torrent_file_priorities(this.torrentId, priorities, {
                    success: function() {
                        Ext.each(nodes, function(node) {
                            node.setColumnValue(3, baseItem.filePriority);
                        });
                    },
                    scope: this
                });
                break;
        }
    },

    onRequestComplete: function(files, options) {
        if (!this.getRootNode().hasChildNodes()) {
            this.createFileTree(files);
        } else {
            this.updateFileTree(files);
        }
    }
});
