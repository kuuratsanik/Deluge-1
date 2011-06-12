/*!
 * Deluge.EditTrackers.js
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
Ext.ns('Deluge');

/**
 * @class Deluge.EditTrackerWindow
 * @extends Ext.Window
 */
Ext.define('Deluge.EditTrackersWindow', {
    extend: 'Ext.Window',

    title: _('Edit Trackers'),
    layout: 'fit',
    width: 350,
    height: 220,
    plain: true,
    closable: true,
    resizable: true,

    bodyStyle: 'padding: 5px',
    buttonAlign: 'right',
    closeAction: 'hide',
    iconCls: 'x-deluge-edit-trackers',

    initComponent: function() {
        this.callParent(arguments);

        //this.addButton(_('Cancel'), this.onCancelClick, this);
        //this.addButton(_('Ok'), this.onOkClick, this);
        this.addEvents('save');

        this.on('show', this.onShow, this);

        this.addWindow = Ext.create('Deluge.AddTrackerWindow');
        this.addWindow.on('add', this.onAddTrackers, this);
        this.editWindow = Ext.create('Deluge.EditTrackerWindow');

        this.list = new Ext.list.ListView({
            store: new Ext.data.JsonStore({
                root: 'trackers',
                fields: [
                    'tier',
                    'url'
                ]
            }),
            columns: [{
                header: _('Tier'),
                width: .1,
                dataIndex: 'tier'
            }, {
                header: _('Tracker'),
                width: .9,
                dataIndex: 'url'
            }],
            columnSort: {
                sortClasses: ['', '']
            },
            stripeRows: true,
            singleSelect: true,
            listeners: {
                'dblclick': {fn: this.onListNodeDblClicked, scope: this},
                'selectionchange': {fn: this.onSelect, scope: this}
            }
        });

        this.panel = this.add({
            margins: '0 0 0 0',
            items: [this.list],
            autoScroll: true,
            bbar: new Ext.Toolbar({
                items: [
                    {
                        text: _('Up'),
                        iconCls: 'icon-up',
                        handler: this.onUpClick,
                        scope: this
                    }, {
                        text: _('Down'),
                        iconCls: 'icon-down',
                        handler: this.onDownClick,
                        scope: this
                    }, '->', {
                        text: _('Add'),
                        iconCls: 'icon-add',
                        handler: this.onAddClick,
                        scope: this
                    }, {
                        text: _('Edit'),
                        iconCls: 'icon-edit-trackers',
                        handler: this.onEditClick,
                        scope: this
                    }, {
                        text: _('Remove'),
                        iconCls: 'icon-remove',
                        handler: this.onRemoveClick,
                        scope: this
                    }
                ]
            })
        });
    },

    onAddClick: function() {
        this.addWindow.show();
    },

    onAddTrackers: function(trackers) {
        var store = this.list.getStore();
        Ext.each(trackers, function(tracker) {
            var duplicate = false, heightestTier = -1;
            store.each(function(record) {
                if (record.get('tier') > heightestTier) {
                    heightestTier = record.get('tier');
                }
                if (tracker == record.get('tracker')) {
                    duplicate = true;
                    return false;
                }
            }, this);
            if (duplicate) return;
            store.add(new store.recordType({'tier': heightestTier + 1, 'url': tracker}));
        }, this);
    },

    onCancelClick: function() {
        this.hide();
    },

    onEditClick: function() {
        this.editWindow.show(this.list.getSelectedRecords()[0]);
    },

    onHide: function() {
        this.list.getStore().removeAll();
    },

    onListNodeDblClicked: function(list, index, node, e) {
        this.editWindow.show(this.list.getRecord(node));
    },

    onOkClick: function() {
        var trackers = [];
        this.list.getStore().each(function(record) {
            trackers.push({
                'tier': record.get('tier'),
                'url': record.get('url')
            })
        }, this);

        deluge.client.core.set_torrent_trackers(this.torrentId, trackers, {
            failure: this.onSaveFail,
            scope: this
        });

        this.hide();
    },

    onRemoveClick: function() {
        // Remove from the grid
        this.list.getStore().remove(this.list.getSelectedRecords()[0]);
    },

    onRequestComplete: function(status) {
        this.list.getStore().loadData(status);
        this.list.getStore().sort('tier', 'ASC');
    },

    onSave: function() {
        // What am I meant to do here?
    },

    onSaveFail: function() {

    },

    onSelect: function(list) {
        if (list.getSelectionCount()) {
            this.panel.getBottomToolbar().items.get(4).enable();
        }
    },

    onShow: function() {
        this.panel.getBottomToolbar().items.get(4).disable();
        var r = deluge.torrents.getSelected();
        this.torrentId = r.id;
        deluge.client.core.get_torrent_status(r.id, ['trackers'], {
            success: this.onRequestComplete,
            scope: this
        });
    },

    onDownClick: function() {
        var r = this.list.getSelectedRecords()[0];
        if (!r) return;

        r.set('tier', r.get('tier') + 1);
        r.store.sort('tier', 'ASC');
        r.store.commitChanges();

        this.list.select(r.store.indexOf(r));
    },

    onUpClick: function() {
        var r = this.list.getSelectedRecords()[0];
        if (!r) return;

        if (r.get('tier') == 0) return;
        r.set('tier', r.get('tier') - 1);
        r.store.sort('tier', 'ASC');
        r.store.commitChanges();

        this.list.select(r.store.indexOf(r));
    }
});
