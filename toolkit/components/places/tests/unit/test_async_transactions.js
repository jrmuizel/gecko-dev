/* -*- indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* vim:set ts=2 sw=2 sts=2 et: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const bmsvc   = PlacesUtils.bookmarks;
const tagssvc = PlacesUtils.tagging;
const annosvc = PlacesUtils.annotations;
const PT      = PlacesTransactions;

// Create and add bookmarks observer.
let observer = {
  __proto__: NavBookmarkObserver.prototype,

  tagRelatedGUIDs: new Set(),

  reset: function () {
    this.itemsAdded = new Map();
    this.itemsRemoved = new Map();
    this.itemsChanged = new Map();
    this.itemsMoved = new Map();
    this.beginUpdateBatch = false;
    this.endUpdateBatch = false;
  },

  onBeginUpdateBatch: function () {
    this.beginUpdateBatch = true;
  },

  onEndUpdateBatch: function () {
    this.endUpdateBatch = true;
  },

  onItemAdded:
  function (aItemId, aParentId, aIndex, aItemType, aURI, aTitle, aDateAdded,
            aGUID, aParentGUID) {
    // Ignore tag items.
    if (aParentId == PlacesUtils.tagsFolderId ||
        (aParentId != PlacesUtils.placesRootId &&
         bmsvc.getFolderIdForItem(aParentId) == PlacesUtils.tagsFolderId)) {
      this.tagRelatedGUIDs.add(aGUID);
      return;
    }

    this.itemsAdded.set(aGUID, { itemId:         aItemId
                               , parentGUID:     aParentGUID
                               , index:          aIndex
                               , itemType:       aItemType
                               , title:          aTitle
                               , uri:            aURI });
  },

  onItemRemoved:
  function (aItemId, aParentId, aIndex, aItemType, aURI, aGUID, aParentGUID) {
    if (this.tagRelatedGUIDs.has(aGUID))
      return;

    this.itemsRemoved.set(aGUID, { parentGUID: aParentGUID
                                 , index:      aIndex
                                 , itemType:   aItemType });
  },

  onItemChanged:
  function (aItemId, aProperty, aIsAnnoProperty, aNewValue, aLastModified,
            aItemType, aParentId, aGUID, aParentGUID) {
    if (this.tagRelatedGUIDs.has(aGUID))
      return;

    let changesForGUID = this.itemsChanged.get(aGUID);
    if (changesForGUID === undefined) {
      changesForGUID = new Map();
      this.itemsChanged.set(aGUID, changesForGUID);
    }

    let newValue = aNewValue;
    if (aIsAnnoProperty) {
      if (annosvc.itemHasAnnotation(aItemId, aProperty))
        newValue = annosvc.getItemAnnotation(aItemId, aProperty);
      else
        newValue = null;
    }
    let change = { isAnnoProperty: aIsAnnoProperty
                 , newValue: newValue
                 , lastModified: aLastModified
                 , itemType: aItemType };
    changesForGUID.set(aProperty, change);
  },

  onItemVisited: () => {},

  onItemMoved:
  function (aItemId, aOldParent, aOldIndex, aNewParent, aNewIndex, aItemType,
            aGUID, aOldParentGUID, aNewParentGUID) {
    this.itemsMoved.set(aGUID, { oldParentGUID: aOldParentGUID
                               , oldIndex:      aOldIndex
                               , newParentGUID: aNewParentGUID
                               , newIndex:      aNewIndex
                               , itemType:      aItemType });
  }
};
observer.reset();

// index at which items should begin
let bmStartIndex = 0;

// get bookmarks root id
let root = PlacesUtils.bookmarksMenuFolderId;

function run_test() {
  bmsvc.addObserver(observer, false);
  do_register_cleanup(function () {
    bmsvc.removeObserver(observer);
  });

  run_next_test();
}

function sanityCheckTransactionHistory() {
  do_check_true(PT.undoPosition <= PT.length);

  let check_entry_throws = f => {
    try {
      f();
      do_throw("PT.entry should throw for invalid input");
    } catch(ex) {}
  };
  check_entry_throws( () => PT.entry(-1) );
  check_entry_throws( () => PT.entry({}) );
  check_entry_throws( () => PT.entry(PT.length) );

  if (PT.undoPosition < PT.length)
    do_check_eq(PT.topUndoEntry, PT.entry(PT.undoPosition));
  else
    do_check_null(PT.topUndoEntry);
  if (PT.undoPosition > 0)
    do_check_eq(PT.topRedoEntry, PT.entry(PT.undoPosition - 1));
  else
    do_check_null(PT.topRedoEntry);
}

function getTransactionsHistoryState() {
  let history = [];
  for (let i = 0; i < PT.length; i++) {
    history.push(PT.entry(i));
  }
  return [history, PT.undoPosition];
}

function ensureUndoState(aExpectedEntries = [], aExpectedUndoPosition = 0) {
  // ensureUndoState is called in various places during this test, so it's
  // a good places to sanity-check the transaction-history APIs in all
  // cases.
  sanityCheckTransactionHistory();

  let [actualEntries, actualUndoPosition] = getTransactionsHistoryState();
  do_check_eq(actualEntries.length, aExpectedEntries.length);
  do_check_eq(actualUndoPosition, aExpectedUndoPosition);

  function checkEqualEntries(aExpectedEntry, aActualEntry) {
    do_check_eq(aExpectedEntry.length, aActualEntry.length);
    aExpectedEntry.forEach( (t, i) => do_check_eq(t, aActualEntry[i]) );
  }
  aExpectedEntries.forEach( (e, i) => checkEqualEntries(e, actualEntries[i]) );
}

function ensureItemsAdded(...items) {
  Assert.equal(observer.itemsAdded.size, items.length);
  for (let item of items) {
    Assert.ok(observer.itemsAdded.has(item.GUID));
    let info = observer.itemsAdded.get(item.GUID);
    Assert.equal(info.parentGUID, item.parentGUID);
    for (let propName of ["title", "index", "itemType"]) {
      if (propName in item)
        Assert.equal(info[propName], item[propName]);
    }
    if ("uri" in item)
      Assert.ok(info.uri.equals(item.uri));
  }
}

function ensureItemsRemoved(...items) {
  Assert.equal(observer.itemsRemoved.size, items.length);
  for (let item of items) {
    // We accept both guids and full info object here.
    if (typeof(item) == "string") {
      Assert.ok(observer.itemsRemoved.has(item));
    }
    else {
      Assert.ok(observer.itemsRemoved.has(item.GUID));
      let info = observer.itemsRemoved.get(item.GUID);
      Assert.equal(info.parentGUID, item.parentGUID);
      if ("index" in item)
        Assert.equal(info.index, item.index);
    }
  }
}

function ensureItemsChanged(...items) {
  for (let item of items) {
    do_check_true(observer.itemsChanged.has(item.GUID));
    let changes = observer.itemsChanged.get(item.GUID);
    do_check_true(changes.has(item.property));
    let info = changes.get(item.property);
    do_check_eq(info.isAnnoProperty, Boolean(item.isAnnoProperty));
    do_check_eq(info.newValue, item.newValue);
    if ("uri" in item)
      do_check_true(item.uri.equals(info.uri));
  }
}

function ensureAnnotationsSet(aGUID, aAnnos) {
  do_check_true(observer.itemsChanged.has(aGUID));
  let changes = observer.itemsChanged.get(aGUID);
  for (let anno of aAnnos) {
    do_check_true(changes.has(anno.name));
    let changeInfo = changes.get(anno.name);
    do_check_true(changeInfo.isAnnoProperty);
    do_check_eq(changeInfo.newValue, anno.value);
  }
}

function ensureItemsMoved(...items) {
  do_check_true(observer.itemsMoved.size, items.length);
  for (let item of items) {
    do_check_true(observer.itemsMoved.has(item.GUID));
    let info = observer.itemsMoved.get(item.GUID);
    do_check_eq(info.oldParentGUID, item.oldParentGUID);
    do_check_eq(info.oldIndex, item.oldIndex);
    do_check_eq(info.newParentGUID, item.newParentGUID);
    do_check_eq(info.newIndex, item.newIndex);
  }
}

function ensureTimestampsUpdated(aGUID, aCheckDateAdded = false) {
  do_check_true(observer.itemsChanged.has(aGUID));
  let changes = observer.itemsChanged.get(aGUID);
  if (aCheckDateAdded)
    do_check_true(changes.has("dateAdded"))
  do_check_true(changes.has("lastModified"));
}

function ensureTagsForURI(aURI, aTags) {
  let tagsSet = tagssvc.getTagsForURI(aURI);
  do_check_eq(tagsSet.length, aTags.length);
  do_check_true(aTags.every( t => tagsSet.indexOf(t) != -1 ));
}

function* createTestFolderInfo(aTitle = "Test Folder") {
  return { parentGUID: yield PlacesUtils.promiseItemGUID(root)
         , title: "Test Folder" };
}

function isLivemarkTree(aTree) {
  return !!aTree.annos &&
         aTree.annos.some( a => a.name == PlacesUtils.LMANNO_FEEDURI );
}

function* ensureLivemarkCreatedByAddLivemark(aLivemarkGUID) {
  // This throws otherwise.
  yield PlacesUtils.livemarks.getLivemark({ guid: aLivemarkGUID });
}

// Checks if two bookmark trees (as returned by promiseBookmarksTree) are the
// same.
// false value for aCheckParentAndPosition is ignored if aIsRestoredItem is set.
function* ensureEqualBookmarksTrees(aOriginal,
                                    aNew,
                                    aIsRestoredItem = true,
                                    aCheckParentAndPosition = false) {
  // Note "id" is not-enumerable, and is therefore skipped by Object.keys (both
  // ours and the one at deepEqual). This is fine for us because ids are not
  // restored by Redo.
  if (aIsRestoredItem) {
    Assert.deepEqual(aOriginal, aNew);
    if (isLivemarkTree(aNew))
      yield ensureLivemarkCreatedByAddLivemark(aNew.guid);
    return;
  }

  for (let property of Object.keys(aOriginal)) {
    if (property == "children") {
      Assert.equal(aOriginal.children.length, aNew.children.length);
      for (let i = 0; i < aOriginal.children.length; i++) {
        yield ensureEqualBookmarksTrees(aOriginal.children[i],
                                        aNew.children[i],
                                        false,
                                        true);
      }
    }
    else if (property == "guid") {
      // guid shouldn't be copied if the item was not restored.
      Assert.notEqual(aOriginal.guid, aNew.guid);
    }
    else if (property == "dateAdded") {
      // dateAdded shouldn't be copied if the item was not restored.
      Assert.ok(is_time_ordered(aOriginal.dateAdded, aNew.dateAdded));
    }
    else if (property == "lastModified") {
      // same same, except for the never-changed case
      if (!aOriginal.lastModified)
        Assert.ok(!aNew.lastModified);
      else
        Assert.ok(is_time_ordered(aOriginal.lastModified, aNew.lastModified));
    }
    else if (aCheckParentAndPosition ||
             (property != "parentGUID" && property != "index")) {
      Assert.deepEqual(aOriginal[property], aNew[property]);
    }
  }

  if (isLivemarkTree(aNew))
    yield ensureLivemarkCreatedByAddLivemark(aNew.guid);
}

function* ensureBookmarksTreeRestoredCorrectly(aOriginalBookmarksTree) {
  let restoredTree =
    yield PlacesUtils.promiseBookmarksTree(aOriginalBookmarksTree.guid);
  yield ensureEqualBookmarksTrees(aOriginalBookmarksTree, restoredTree);
}

function* ensureNonExistent(...aGUIDs) {
  for (let guid of aGUIDs) {
    Assert.strictEqual((yield PlacesUtils.promiseBookmarksTree(guid)), null);
  }
}

add_task(function* test_invalid_transact_calls() {
  try {
    PT.transact({ execute: () => {}, undo: () => {}, redo: () => {}});
    do_throw("transact shouldn't accept 'external' transactions");
    PT.transact(null);
    do_throw("transact should throw for invalid arguments");
  }
  catch(ex) { }
});

add_task(function* test_recycled_transactions() {
  function ensureTransactThrowsFor(aTransaction) {
    let [txns, undoPosition] = getTransactionsHistoryState();
    try {
      yield PT.transact(aTransaction);
      do_throw("Shouldn't be able to use the same transaction twice");
    }
    catch(ex) { }
    ensureUndoState(txns, undoPosition);
  }

  let txn_a = PT.NewFolder(yield createTestFolderInfo());
  ensureTransactThrowsFor(txn_a);
  yield PT.transact(txn_a);
  ensureUndoState([[txn_a]], 0);

  yield PT.undo();
  ensureUndoState([[txn_a]], 1);
  ensureTransactThrowsFor(txn_a);

  yield PT.clearTransactionsHistory();
  ensureUndoState();
  ensureTransactThrowsFor(txn_a);

  let txn_b = PT.NewFolder(yield createTestFolderInfo());
  yield PT.transact(function* () {
    try {
      yield txn_a;
      do_throw("Shouldn't be able to use the same transaction twice");
    }
    catch(ex) { }
    ensureUndoState();
    yield txn_b;
  });
  ensureUndoState([[txn_b]], 0);

  yield PT.undo();
  ensureUndoState([[txn_b]], 1);
  ensureTransactThrowsFor(txn_a);
  ensureTransactThrowsFor(txn_b);

  yield PT.clearTransactionsHistory();
  ensureUndoState();
  observer.reset();
});

add_task(function* test_nested_batches() {
  let txn_a = PT.NewFolder(yield createTestFolderInfo()),
      txn_b = PT.NewFolder(yield createTestFolderInfo());
  yield PT.transact(function* () {
    yield txn_a;
    yield (function*() {
      yield txn_b;
    }());
  });
  ensureUndoState([[txn_b, txn_a]], 0);

  yield PT.undo();
  ensureUndoState([[txn_b, txn_a]], 1);

  yield PT.clearTransactionsHistory();
  ensureUndoState();
  observer.reset();
});

add_task(function* test_new_folder_with_annotation() {
  const ANNO = { name: "TestAnno", value: "TestValue" };
  let folder_info = yield createTestFolderInfo();
  folder_info.index = bmStartIndex;
  folder_info.annotations = [ANNO];
  ensureUndoState();
  let txn = PT.NewFolder(folder_info);
  folder_info.GUID = yield PT.transact(txn);
  let ensureDo = function* (aRedo = false) {
    ensureUndoState([[txn]], 0);
    yield ensureItemsAdded(folder_info);
    ensureAnnotationsSet(folder_info.GUID, [ANNO]);
    if (aRedo)
      ensureTimestampsUpdated(folder_info.GUID, true);
    observer.reset();
  };

  let ensureUndo = () => {
    ensureUndoState([[txn]], 1);
    ensureItemsRemoved({ GUID:       folder_info.GUID
                       , parentGUID: folder_info.parentGUID
                       , index:      bmStartIndex });
    observer.reset();
  };

  yield ensureDo();
  yield PT.undo();
  yield ensureUndo();
  yield PT.redo();
  yield ensureDo(true);
  yield PT.undo();
  ensureUndo();
  yield PT.clearTransactionsHistory();
  ensureUndoState();
});

add_task(function* test_new_bookmark() {
  let bm_info = { parentGUID: yield PlacesUtils.promiseItemGUID(root)
                , uri:        NetUtil.newURI("http://test_create_item.com")
                , index:      bmStartIndex
                , title:      "Test creating an item" };

  ensureUndoState();
  let txn = PT.NewBookmark(bm_info);
  bm_info.GUID = yield PT.transact(txn);

  let ensureDo = function* (aRedo = false) {
    ensureUndoState([[txn]], 0);
    yield ensureItemsAdded(bm_info);
    if (aRedo)
      ensureTimestampsUpdated(bm_info.GUID, true);
    observer.reset();
  };
  let ensureUndo = () => {
    ensureUndoState([[txn]], 1);
    ensureItemsRemoved({ GUID:       bm_info.GUID
                       , parentGUID: bm_info.parentGUID
                       , index:      bmStartIndex });
    observer.reset();
  };

  yield ensureDo();
  yield PT.undo();
  ensureUndo();
  yield PT.redo(true);
  yield ensureDo();
  yield PT.undo();
  ensureUndo();

  yield PT.clearTransactionsHistory();
  ensureUndoState();
});

add_task(function* test_merge_create_folder_and_item() {
  let folder_info = yield createTestFolderInfo();
  let bm_info = { uri: NetUtil.newURI("http://test_create_item_to_folder.com")
                , title: "Test Bookmark"
                , index: bmStartIndex };

  let { folderTxn, bkmTxn } = yield PT.transact( function* () {
    let folderTxn = PT.NewFolder(folder_info);
    folder_info.GUID = bm_info.parentGUID = yield folderTxn;
    let bkmTxn = PT.NewBookmark(bm_info);
    bm_info.GUID = yield bkmTxn;;
    return { folderTxn: folderTxn, bkmTxn: bkmTxn};
  });

  let ensureDo = function* () {
    ensureUndoState([[bkmTxn, folderTxn]], 0);
    yield ensureItemsAdded(folder_info, bm_info);
    observer.reset();
  };

  let ensureUndo = () => {
    ensureUndoState([[bkmTxn, folderTxn]], 1);
    ensureItemsRemoved(folder_info, bm_info);
    observer.reset();
  };

  yield ensureDo();
  yield PT.undo();
  ensureUndo();
  yield PT.redo();
  yield ensureDo();
  yield PT.undo();
  ensureUndo();

  yield PT.clearTransactionsHistory();
  ensureUndoState();
});

add_task(function* test_move_items_to_folder() {
  let folder_a_info = yield createTestFolderInfo("Folder A");
  let bkm_a_info = { uri: NetUtil.newURI("http://test_move_items.com")
                   , title: "Bookmark A" };
  let bkm_b_info = { uri: NetUtil.newURI("http://test_move_items.com")
                   , title: "Bookmark B" };

  // Test moving items within the same folder.
  let [folder_a_txn, bkm_a_txn, bkm_b_txn] = yield PT.transact(function* () {
    let folder_a_txn = PT.NewFolder(folder_a_info);

    folder_a_info.GUID =
      bkm_a_info.parentGUID = bkm_b_info.parentGUID = yield folder_a_txn;
    let bkm_a_txn = PT.NewBookmark(bkm_a_info);
    bkm_a_info.GUID = yield bkm_a_txn;
    let bkm_b_txn = PT.NewBookmark(bkm_b_info);
    bkm_b_info.GUID = yield bkm_b_txn;
    return [folder_a_txn, bkm_a_txn, bkm_b_txn];
  });

  ensureUndoState([[bkm_b_txn, bkm_a_txn, folder_a_txn]], 0);

  let moveTxn = PT.Move({ GUID:          bkm_a_info.GUID
                        , newParentGUID: folder_a_info.GUID });
  yield PT.transact(moveTxn);

  let ensureDo = () => {
    ensureUndoState([[moveTxn], [bkm_b_txn, bkm_a_txn, folder_a_txn]], 0);
    ensureItemsMoved({ GUID:          bkm_a_info.GUID
                     , oldParentGUID: folder_a_info.GUID
                     , newParentGUID: folder_a_info.GUID
                     , oldIndex:      0
                     , newIndex:      1 });
    observer.reset();
  };
  let ensureUndo = () => {
    ensureUndoState([[moveTxn], [bkm_b_txn, bkm_a_txn, folder_a_txn]], 1);
    ensureItemsMoved({ GUID:          bkm_a_info.GUID
                     , oldParentGUID: folder_a_info.GUID
                     , newParentGUID: folder_a_info.GUID
                     , oldIndex:      1
                     , newIndex:      0 });
    observer.reset();
  };

  ensureDo();
  yield PT.undo();
  ensureUndo();
  yield PT.redo();
  ensureDo();
  yield PT.undo();
  ensureUndo();

  yield PT.clearTransactionsHistory(false, true);
  ensureUndoState([[bkm_b_txn, bkm_a_txn, folder_a_txn]], 0);

  // Test moving items between folders.
  let folder_b_info = yield createTestFolderInfo("Folder B");
  let folder_b_txn = PT.NewFolder(folder_b_info);
  folder_b_info.GUID = yield PT.transact(folder_b_txn);
  ensureUndoState([ [folder_b_txn]
                  , [bkm_b_txn, bkm_a_txn, folder_a_txn] ], 0);

  moveTxn = PT.Move({ GUID:          bkm_a_info.GUID
                    , newParentGUID: folder_b_info.GUID
                    , newIndex:      bmsvc.DEFAULT_INDEX });
  yield PT.transact(moveTxn);

  ensureDo = () => {
    ensureUndoState([ [moveTxn]
                    , [folder_b_txn]
                    , [bkm_b_txn, bkm_a_txn, folder_a_txn] ], 0);
    ensureItemsMoved({ GUID:          bkm_a_info.GUID
                     , oldParentGUID: folder_a_info.GUID
                     , newParentGUID: folder_b_info.GUID
                     , oldIndex:      0
                     , newIndex:      0 });
    observer.reset();
  };
  ensureUndo = () => {
    ensureUndoState([ [moveTxn]
                    , [folder_b_txn]
                    , [bkm_b_txn, bkm_a_txn, folder_a_txn] ], 1);
    ensureItemsMoved({ GUID:          bkm_a_info.GUID
                     , oldParentGUID: folder_b_info.GUID
                     , newParentGUID: folder_a_info.GUID
                     , oldIndex:      0
                     , newIndex:      0 });
    observer.reset();
  };

  ensureDo();
  yield PT.undo();
  ensureUndo();
  yield PT.redo();
  ensureDo();
  yield PT.undo();
  ensureUndo();

  // Clean up
  yield PT.undo();  // folder_b_txn
  yield PT.undo();  // folder_a_txn + the bookmarks;
  do_check_eq(observer.itemsRemoved.size, 4);
  ensureUndoState([ [moveTxn]
                  , [folder_b_txn]
                  , [bkm_b_txn, bkm_a_txn, folder_a_txn] ], 3);
  yield PT.clearTransactionsHistory();
  ensureUndoState();
});

add_task(function* test_remove_folder() {
  let folder_level_1_info = yield createTestFolderInfo("Folder Level 1");
  let folder_level_2_info = { title: "Folder Level 2" };
  let [folder_level_1_txn,
       folder_level_2_txn] = yield PT.transact(function* () {
    let folder_level_1_txn  = PT.NewFolder(folder_level_1_info);
    folder_level_1_info.GUID = yield folder_level_1_txn;
    folder_level_2_info.parentGUID = folder_level_1_info.GUID;
    let folder_level_2_txn = PT.NewFolder(folder_level_2_info);
    folder_level_2_info.GUID = yield folder_level_2_txn;
    return [folder_level_1_txn, folder_level_2_txn];
  });

  ensureUndoState([[folder_level_2_txn, folder_level_1_txn]]);
  yield ensureItemsAdded(folder_level_1_info, folder_level_2_info);
  observer.reset();

  let remove_folder_2_txn = PT.Remove(folder_level_2_info);
  yield PT.transact(remove_folder_2_txn);

  ensureUndoState([ [remove_folder_2_txn]
                  , [folder_level_2_txn, folder_level_1_txn] ]);
  yield ensureItemsRemoved(folder_level_2_info);

  // Undo Remove "Folder Level 2"
  yield PT.undo();
  ensureUndoState([ [remove_folder_2_txn]
                  , [folder_level_2_txn, folder_level_1_txn] ], 1);
  yield ensureItemsAdded(folder_level_2_info);
  ensureTimestampsUpdated(folder_level_2_info.GUID, true);
  observer.reset();

  // Redo Remove "Folder Level 2"
  yield PT.redo();
  ensureUndoState([ [remove_folder_2_txn]
                  , [folder_level_2_txn, folder_level_1_txn] ]);
  yield ensureItemsRemoved(folder_level_2_info);
  observer.reset();

  // Undo it again
  yield PT.undo();
  ensureUndoState([ [remove_folder_2_txn]
                  , [folder_level_2_txn, folder_level_1_txn] ], 1);
  yield ensureItemsAdded(folder_level_2_info);
  ensureTimestampsUpdated(folder_level_2_info.GUID, true);
  observer.reset();

  // Undo the creation of both folders
  yield PT.undo();
  ensureUndoState([ [remove_folder_2_txn]
                  , [folder_level_2_txn, folder_level_1_txn] ], 2);
  yield ensureItemsRemoved(folder_level_2_info, folder_level_1_info);
  observer.reset();

  // Redo the creation of both folders
  yield PT.redo();
  ensureUndoState([ [remove_folder_2_txn]
                  , [folder_level_2_txn, folder_level_1_txn] ], 1);
  yield ensureItemsAdded(folder_level_1_info, folder_level_2_info);
  ensureTimestampsUpdated(folder_level_1_info.GUID, true);
  ensureTimestampsUpdated(folder_level_2_info.GUID, true);
  observer.reset();

  // Redo Remove "Folder Level 2"
  yield PT.redo();
  ensureUndoState([ [remove_folder_2_txn]
                  , [folder_level_2_txn, folder_level_1_txn] ]);
  yield ensureItemsRemoved(folder_level_2_info);
  observer.reset();

  // Undo everything one last time
  yield PT.undo();
  ensureUndoState([ [remove_folder_2_txn]
                  , [folder_level_2_txn, folder_level_1_txn] ], 1);
  yield ensureItemsAdded(folder_level_2_info);
  observer.reset();

  yield PT.undo();
  ensureUndoState([ [remove_folder_2_txn]
                  , [folder_level_2_txn, folder_level_1_txn] ], 2);
  yield ensureItemsRemoved(folder_level_2_info, folder_level_2_info);
  observer.reset();

  yield PT.clearTransactionsHistory();
  ensureUndoState();
});

add_task(function* test_add_and_remove_bookmarks_with_additional_info() {
  const testURI = NetUtil.newURI("http://add.remove.tag")
      , TAG_1 = "TestTag1", TAG_2 = "TestTag2"
      , KEYWORD = "test_keyword"
      , POST_DATA = "post_data"
      , ANNO = { name: "TestAnno", value: "TestAnnoValue" };

  let folder_info = yield createTestFolderInfo();
  folder_info.GUID = yield PT.transact(PT.NewFolder(folder_info));
  let ensureTags = ensureTagsForURI.bind(null, testURI);

  // Check that the NewBookmark transaction preserves tags.
  observer.reset();
  let b1_info = { parentGUID: folder_info.GUID, uri: testURI, tags: [TAG_1] };
  b1_info.GUID = yield PT.transact(PT.NewBookmark(b1_info));
  ensureTags([TAG_1]);
  yield PT.undo();
  ensureTags([]);

  observer.reset();
  yield PT.redo();
  ensureTimestampsUpdated(b1_info.GUID, true);
  ensureTags([TAG_1]);

  // Check if the Remove transaction removes and restores tags of children
  // correctly.
  yield PT.transact(PT.Remove(folder_info.GUID));
  ensureTags([]);

  observer.reset();
  yield PT.undo();
  ensureTimestampsUpdated(b1_info.GUID, true);
  ensureTags([TAG_1]);

  yield PT.redo();
  ensureTags([]);

  observer.reset();
  yield PT.undo();
  ensureTimestampsUpdated(b1_info.GUID, true);
  ensureTags([TAG_1]);

  // * Check that no-op tagging (the uri is already tagged with TAG_1) is
  //   also a no-op on undo.
  // * Test the "keyword" property of the NewBookmark transaction.
  observer.reset();
  let b2_info = { parentGUID:  folder_info.GUID
                , uri:         testURI, tags: [TAG_1, TAG_2]
                , keyword:     KEYWORD
                , postData:    POST_DATA
                , annotations: [ANNO] };
  b2_info.GUID = yield PT.transact(PT.NewBookmark(b2_info));
  let b2_post_creation_changes = [
   { GUID: b2_info.GUID
   , isAnnoProperty: true
   , property: ANNO.name
   , newValue: ANNO.value },
   { GUID: b2_info.GUID
   , property: "keyword"
   , newValue: KEYWORD },
   { GUID: b2_info.GUID
   , isAnnoProperty: true
   , property: PlacesUtils.POST_DATA_ANNO
   , newValue: POST_DATA } ];
  ensureItemsChanged(...b2_post_creation_changes);
  ensureTags([TAG_1, TAG_2]);

  observer.reset();
  yield PT.undo();
  yield ensureItemsRemoved(b2_info);
  ensureTags([TAG_1]);

  // Check if Remove correctly restores keywords, tags and annotations.
  observer.reset();
  yield PT.redo();
  ensureItemsChanged(...b2_post_creation_changes);
  ensureTags([TAG_1, TAG_2]);

  // Test Remove for multiple items.
  observer.reset();
  yield PT.transact(PT.Remove(b1_info.GUID));
  yield PT.transact(PT.Remove(b2_info.GUID));
  yield PT.transact(PT.Remove(folder_info.GUID));
  yield ensureItemsRemoved(b1_info, b2_info, folder_info);
  ensureTags([]);

  observer.reset();
  yield PT.undo();
  yield ensureItemsAdded(folder_info);
  ensureTags([]);

  observer.reset();
  yield PT.undo();
  ensureItemsChanged(...b2_post_creation_changes);
  ensureTags([TAG_1, TAG_2]);

  observer.reset();
  yield PT.undo();
  yield ensureItemsAdded(b1_info);
  ensureTags([TAG_1, TAG_2]);

  // The redo calls below cleanup everything we did.
  observer.reset();
  yield PT.redo();
  yield ensureItemsRemoved(b1_info);
  ensureTags([TAG_1, TAG_2]);

  observer.reset();
  yield PT.redo();
  yield ensureItemsRemoved(b2_info);
  ensureTags([]);

  observer.reset();
  yield PT.redo();
  yield ensureItemsRemoved(folder_info);
  ensureTags([]);

  yield PT.clearTransactionsHistory();
  ensureUndoState();
});

add_task(function* test_creating_and_removing_a_separator() {
  let folder_info = yield createTestFolderInfo();
  let separator_info = {};
  let undoEntries = [];

  observer.reset();
  let create_txns = yield PT.transact(function* () {
    let folder_txn = PT.NewFolder(folder_info);
    folder_info.GUID = separator_info.parentGUID = yield folder_txn;
    let separator_txn = PT.NewSeparator(separator_info);
    separator_info.GUID = yield separator_txn;
    return [separator_txn, folder_txn];
  });
  undoEntries.unshift(create_txns);
  ensureUndoState(undoEntries, 0);
  ensureItemsAdded(folder_info, separator_info);

  observer.reset();
  yield PT.undo();
  ensureUndoState(undoEntries, 1);
  ensureItemsRemoved(folder_info, separator_info);

  observer.reset();
  yield PT.redo();
  ensureUndoState(undoEntries, 0);
  ensureItemsAdded(folder_info, separator_info);

  observer.reset();
  let remove_sep_txn = PT.Remove(separator_info);
  yield PT.transact(remove_sep_txn);
  undoEntries.unshift([remove_sep_txn]);
  ensureUndoState(undoEntries, 0);
  ensureItemsRemoved(separator_info);

  observer.reset();
  yield PT.undo();
  ensureUndoState(undoEntries, 1);
  ensureItemsAdded(separator_info);

  observer.reset();
  yield PT.undo();
  ensureUndoState(undoEntries, 2);
  ensureItemsRemoved(folder_info, separator_info);

  observer.reset();
  yield PT.redo();
  ensureUndoState(undoEntries, 1);
  ensureItemsAdded(folder_info, separator_info);

  // Clear redo entries and check that |redo| does nothing
  observer.reset();
  yield PT.clearTransactionsHistory(false, true);
  undoEntries.shift();
  ensureUndoState(undoEntries, 0);
  yield PT.redo();
  ensureItemsAdded();
  ensureItemsRemoved();

  // Cleanup
  observer.reset();
  yield PT.undo();
  ensureUndoState(undoEntries, 1);
  ensureItemsRemoved(folder_info, separator_info);
  yield PT.clearTransactionsHistory();
  ensureUndoState();
});

add_task(function* test_add_and_remove_livemark() {
  let createLivemarkTxn = PT.NewLivemark(
    { feedURI: NetUtil.newURI("http://test.remove.livemark")
    , parentGUID: yield PlacesUtils.promiseItemGUID(root)
    , title: "Test Remove Livemark" });
  let guid = yield PlacesTransactions.transact(createLivemarkTxn);
  let originalInfo = yield PlacesUtils.promiseBookmarksTree(guid);
  Assert.ok(originalInfo);
  yield ensureLivemarkCreatedByAddLivemark(guid);

  let removeTxn = PT.Remove(guid);
  yield PT.transact(removeTxn);
  yield ensureNonExistent(guid);
  function* undo() {
    ensureUndoState([[removeTxn], [createLivemarkTxn]], 0);
    yield PT.undo();
    ensureUndoState([[removeTxn], [createLivemarkTxn]], 1);
    yield ensureBookmarksTreeRestoredCorrectly(originalInfo);
    yield PT.undo();
    ensureUndoState([[removeTxn], [createLivemarkTxn]], 2);
    yield ensureNonExistent(guid);
  }
  function* redo() {
    ensureUndoState([[removeTxn], [createLivemarkTxn]], 2);
    yield PT.redo();
    ensureUndoState([[removeTxn], [createLivemarkTxn]], 1);
    yield ensureBookmarksTreeRestoredCorrectly(originalInfo);
    yield PT.redo();
    ensureUndoState([[removeTxn], [createLivemarkTxn]], 0);
    yield ensureNonExistent(guid);
  }

  yield undo();
  yield redo();
  yield undo();
  yield redo();

  // Cleanup
  yield undo();
  observer.reset();
  yield PT.clearTransactionsHistory();
});

add_task(function* test_edit_title() {
  let bm_info = { parentGUID: yield PlacesUtils.promiseItemGUID(root)
                , uri:        NetUtil.newURI("http://test_create_item.com")
                , title:      "Original Title" };

  function ensureTitleChange(aCurrentTitle) {
    ensureItemsChanged({ GUID: bm_info.GUID
                       , property: "title"
                       , newValue: aCurrentTitle});
  }

  bm_info.GUID = yield PT.transact(PT.NewBookmark(bm_info));

  observer.reset();
  yield PT.transact(PT.EditTitle({ GUID: bm_info.GUID, title: "New Title" }));
  ensureTitleChange("New Title");

  observer.reset();
  yield PT.undo();
  ensureTitleChange("Original Title");

  observer.reset();
  yield PT.redo();
  ensureTitleChange("New Title");

  // Cleanup
  observer.reset();
  yield PT.undo();
  ensureTitleChange("Original Title");
  yield PT.undo();
  ensureItemsRemoved(bm_info);

  yield PT.clearTransactionsHistory();
  ensureUndoState();
});

add_task(function* test_edit_url() {
  let oldURI = NetUtil.newURI("http://old.test_editing_item_uri.com/");
  let newURI = NetUtil.newURI("http://new.test_editing_item_uri.com/");
  let bm_info = { parentGUID: yield PlacesUtils.promiseItemGUID(root)
                , uri:        oldURI
                , tags:       ["TestTag"]};

  function ensureURIAndTags(aPreChangeURI, aPostChangeURI, aOLdURITagsPreserved) {
    ensureItemsChanged({ GUID: bm_info.GUID
                       , property: "uri"
                       , newValue: aPostChangeURI.spec });
    ensureTagsForURI(aPostChangeURI, bm_info.tags);
    ensureTagsForURI(aPreChangeURI, aOLdURITagsPreserved ? bm_info.tags : []);
  }

  bm_info.GUID = yield PT.transact(PT.NewBookmark(bm_info));
  ensureTagsForURI(oldURI, bm_info.tags);

  // When there's a single bookmark for the same url, tags should be moved.
  observer.reset();
  yield PT.transact(PT.EditURI({ GUID: bm_info.GUID, uri: newURI }));
  ensureURIAndTags(oldURI, newURI, false);

  observer.reset();
  yield PT.undo();
  ensureURIAndTags(newURI, oldURI, false);

  observer.reset();
  yield PT.redo();
  ensureURIAndTags(oldURI, newURI, false);

  observer.reset();
  yield PT.undo();
  ensureURIAndTags(newURI, oldURI, false);

  // When there're multiple bookmarks for the same url, tags should be copied.
  let bm2_info = Object.create(bm_info);
  bm2_info.GUID = yield PT.transact(PT.NewBookmark(bm2_info));
  let bm3_info = Object.create(bm_info);
  bm3_info.uri = newURI;
  bm3_info.GUID = yield PT.transact(PT.NewBookmark(bm3_info));

  observer.reset();
  yield PT.transact(PT.EditURI({ GUID: bm_info.GUID, uri: newURI }));
  ensureURIAndTags(oldURI, newURI, true);

  observer.reset();
  yield PT.undo();
  ensureURIAndTags(newURI, oldURI, true);

  observer.reset();
  yield PT.redo();
  ensureURIAndTags(oldURI, newURI, true);

  // Cleanup
  observer.reset();
  yield PT.undo();
  ensureURIAndTags(newURI, oldURI, true);
  yield PT.undo();
  yield PT.undo();
  yield PT.undo();
  ensureItemsRemoved(bm3_info, bm2_info, bm_info);

  yield PT.clearTransactionsHistory();
  ensureUndoState();
});

add_task(function* test_edit_keyword() {
  let bm_info = { parentGUID: yield PlacesUtils.promiseItemGUID(root)
                , uri:        NetUtil.newURI("http://test.edit.keyword") };
  const KEYWORD = "test_keyword";
  bm_info.GUID = yield PT.transact(PT.NewBookmark(bm_info));
  function ensureKeywordChange(aCurrentKeyword = "") {
    ensureItemsChanged({ GUID: bm_info.GUID
                       , property: "keyword"
                       , newValue: aCurrentKeyword });
  }

  bm_info.GUID = yield PT.transact(PT.NewBookmark(bm_info));

  observer.reset();
  yield PT.transact(PT.EditKeyword({ GUID: bm_info.GUID, keyword: KEYWORD }));
  ensureKeywordChange(KEYWORD);

  observer.reset();
  yield PT.undo();
  ensureKeywordChange();

  observer.reset();
  yield PT.redo();
  ensureKeywordChange(KEYWORD);

  // Cleanup
  observer.reset();
  yield PT.undo();
  ensureKeywordChange();
  yield PT.undo();
  ensureItemsRemoved(bm_info);

  yield PT.clearTransactionsHistory();
  ensureUndoState();
});

add_task(function* doTest() {
  let bm_info_a = { uri: NetUtil.newURI("http://bookmarked.uri")
                  , parentGUID: yield PlacesUtils.promiseItemGUID(root) };
  let bm_info_b = { uri: NetUtil.newURI("http://bookmarked2.uri")
                  , parentGUID: yield PlacesUtils.promiseItemGUID(root) };
  let unbookmarked_uri = NetUtil.newURI("http://un.bookmarked.uri");

  function* promiseIsBookmarked(aURI) {
    let deferred = Promise.defer();
    PlacesUtils.asyncGetBookmarkIds(aURI, ids => {
                                            deferred.resolve(ids.length > 0);
                                          });
    return deferred.promise;
  }

  yield PT.transact(function* () {
    bm_info_a.GUID = yield PT.NewBookmark(bm_info_a);
    bm_info_b.GUID = yield PT.NewBookmark(bm_info_b);
  });

  function* doTest(aInfo) {
    let uris = "uri" in aInfo ? [aInfo.uri] : aInfo.uris;
    let tags = "tag" in aInfo ? [aInfo.tag] : aInfo.tags;

    let tagWillAlsoBookmark = new Set();
    for (let uri of uris) {
      if (!(yield promiseIsBookmarked(uri))) {
        tagWillAlsoBookmark.add(uri);
      }
    }

    function* ensureTagsSet() {
      for (let uri of uris) {
        ensureTagsForURI(uri, tags);
        Assert.ok(yield promiseIsBookmarked(uri));
      }
    }
    function* ensureTagsUnset() {
      for (let uri of uris) {
        ensureTagsForURI(uri, []);
        if (tagWillAlsoBookmark.has(uri))
          Assert.ok(!(yield promiseIsBookmarked(uri)));
        else
          Assert.ok(yield promiseIsBookmarked(uri));
      }
    }

    yield PT.transact(PT.Tag(aInfo));
    yield ensureTagsSet();
    yield PT.undo();
    yield ensureTagsUnset();
    yield PT.redo();
    yield ensureTagsSet();
    yield PT.undo();
    yield ensureTagsUnset();
  }

  yield doTest({ uri: bm_info_a.uri, tags: ["MyTag"] });
  yield doTest({ uris: [bm_info_a.uri], tag: "MyTag" });
  yield doTest({ uris: [bm_info_a.uri, bm_info_b.uri], tags: ["A, B"] });
  yield doTest({ uris: [bm_info_a.uri, unbookmarked_uri], tag: "C" });

  // Cleanup
  observer.reset();
  yield PT.undo();
  ensureItemsRemoved(bm_info_a, bm_info_b);

  yield PT.clearTransactionsHistory();
  ensureUndoState();
});

add_task(function* test_untag_uri() {
  let bm_info_a = { uri: NetUtil.newURI("http://bookmarked.uri")
                  , parentGUID: yield PlacesUtils.promiseItemGUID(root)
                  , tags: ["A", "B"] };
  let bm_info_b = { uri: NetUtil.newURI("http://bookmarked2.uri")
                  , parentGUID: yield PlacesUtils.promiseItemGUID(root)
                  , tag: "B" };

  yield PT.transact(function* () {
    bm_info_a.GUID = yield PT.NewBookmark(bm_info_a);
    ensureTagsForURI(bm_info_a.uri, bm_info_a.tags);
    bm_info_b.GUID = yield PT.NewBookmark(bm_info_b);
    ensureTagsForURI(bm_info_b.uri, [bm_info_b.tag]);
  });

  function* doTest(aInfo) {
    let uris, tagsToRemove;
    if (aInfo instanceof Ci.nsIURI) {
      uris = [aInfo];
      tagsRemoved = [];
    }
    else if (Array.isArray(aInfo)) {
      uris = aInfo;
      tagsRemoved = [];
    }
    else {
      uris = "uri" in aInfo ? [aInfo.uri] : aInfo.uris;
      tagsRemoved = "tag" in aInfo ? [aInfo.tag] : aInfo.tags;
    }

    let preRemovalTags = new Map();
    for (let uri of uris) {
      preRemovalTags.set(uri, tagssvc.getTagsForURI(uri));
    }

    function ensureTagsSet() {
      for (let uri of uris) {
        ensureTagsForURI(uri, preRemovalTags.get(uri));
      }
    }
    function ensureTagsUnset() {
      for (let uri of uris) {
        let expectedTags = tagsRemoved.length == 0 ?
           [] : [for (tag of preRemovalTags.get(uri))
                 if (tagsRemoved.indexOf(tag) == -1) tag];
        ensureTagsForURI(uri, expectedTags);
      }
    }

    yield PT.transact(PT.Untag(aInfo));
    yield ensureTagsUnset();
    yield PT.undo();
    yield ensureTagsSet();
    yield PT.redo();
    yield ensureTagsUnset();
    yield PT.undo();
    yield ensureTagsSet();
  }

  yield doTest(bm_info_a);
  yield doTest(bm_info_b);
  yield doTest(bm_info_a.uri);
  yield doTest(bm_info_b.uri);
  yield doTest([bm_info_a.uri, bm_info_b.uri]);
  yield doTest({ uris: [bm_info_a.uri, bm_info_b.uri], tags: ["A", "B"] });
  yield doTest({ uris: [bm_info_a.uri, bm_info_b.uri], tag: "B" });
  yield doTest({ uris: [bm_info_a.uri, bm_info_b.uri], tag: "C" });
  yield doTest({ uris: [bm_info_a.uri, bm_info_b.uri], tags: ["C"] });

  // Cleanup
  observer.reset();
  yield PT.undo();
  ensureItemsRemoved(bm_info_a, bm_info_b);

  yield PT.clearTransactionsHistory();
  ensureUndoState();
});

add_task(function* test_annotate() {
  let bm_info = { uri: NetUtil.newURI("http://test.item.annotation")
                , parentGUID: yield PlacesUtils.promiseItemGUID(root) };
  let anno_info = { name: "TestAnno", value: "TestValue" };
  function ensureAnnoState(aSet) {
    ensureAnnotationsSet(bm_info.GUID,
                         [{ name: anno_info.name
                          , value: aSet ? anno_info.value : null }]);
  }

  bm_info.GUID = yield PT.transact(PT.NewBookmark(bm_info));

  observer.reset();
  yield PT.transact(PT.Annotate({ GUID: bm_info.GUID, annotation: anno_info }));
  ensureAnnoState(true);

  observer.reset();
  yield PT.undo();
  ensureAnnoState(false);

  observer.reset();
  yield PT.redo();
  ensureAnnoState(true);

  // Test removing the annotation by not passing the |value| property.
  observer.reset();
  yield PT.transact(PT.Annotate({ GUID: bm_info.GUID,
                                  annotation: { name: anno_info.name }}));
  ensureAnnoState(false);

  observer.reset();
  yield PT.undo();
  ensureAnnoState(true);

  observer.reset();
  yield PT.redo();
  ensureAnnoState(false);

  // Cleanup
  yield PT.undo();
  observer.reset();
});

add_task(function* test_annotate_multiple() {
  let guid = yield PT.transact(PT.NewFolder(yield createTestFolderInfo()));
  let itemId = yield PlacesUtils.promiseItemId(guid);

  function AnnoObj(aName, aValue) {
    this.name = aName;
    this.value = aValue;
    this.flags = 0;
    this.expires = Ci.nsIAnnotationService.EXPIRE_NEVER;
  }

  function annos(a = null, b = null) [new AnnoObj("A", a), new AnnoObj("B", b)]

  function verifyAnnoValues(a = null, b = null) {
    let currentAnnos = PlacesUtils.getAnnotationsForItem(itemId);
    let expectedAnnos = [];
    if (a !== null)
      expectedAnnos.push(new AnnoObj("A", a));
    if (b !== null)
      expectedAnnos.push(new AnnoObj("B", b));

    Assert.deepEqual(currentAnnos, expectedAnnos);
  }

  yield PT.transact(PT.Annotate({ GUID: guid, annotations: annos(1, 2) }));
  verifyAnnoValues(1, 2);
  yield PT.undo();
  verifyAnnoValues();
  yield PT.redo();
  verifyAnnoValues(1, 2);

  yield PT.transact(PT.Annotate({ GUID: guid
                                , annotation: { name: "A" } }));
  verifyAnnoValues(null, 2);

  yield PT.transact(PT.Annotate({ GUID: guid
                                , annotation: { name: "B", value: 0 } }));
  verifyAnnoValues(null, 0);
  yield PT.undo();
  verifyAnnoValues(null, 2);
  yield PT.redo();
  verifyAnnoValues(null, 0);
  yield PT.undo();
  verifyAnnoValues(null, 2);
  yield PT.undo();
  verifyAnnoValues(1, 2);
  yield PT.undo();
  verifyAnnoValues();

  // Cleanup
  yield PT.undo();
  observer.reset();
});

add_task(function* test_sort_folder_by_name() {
  let folder_info = yield createTestFolderInfo();

  let uri = NetUtil.newURI("http://sort.by.name/");
  let preSep =  [{ title: i, uri: uri } for (i of ["3","2","1"])];
  let sep = {};
  let postSep = [{ title: l, uri: uri } for (l of ["c","b","a"])];
  let originalOrder = [...preSep, sep, ...postSep];
  let sortedOrder = [...preSep.slice(0).reverse(),
                     sep,
                     ...postSep.slice(0).reverse()];
  yield PT.transact(function* () {
    folder_info.GUID = yield PT.NewFolder(folder_info);
    for (let info of originalOrder) {
      info.parentGUID = folder_info.GUID;
      info.GUID = yield info == sep ?
                  PT.NewSeparator(info) : PT.NewBookmark(info);
    }
  });

  let folderId = yield PlacesUtils.promiseItemId(folder_info.GUID);
  let folderContainer = PlacesUtils.getFolderContents(folderId).root;
  function ensureOrder(aOrder) {
    for (let i = 0; i < folderContainer.childCount; i++) {
      do_check_eq(folderContainer.getChild(i).bookmarkGuid, aOrder[i].GUID);
    }
  }

  ensureOrder(originalOrder);
  yield PT.transact(PT.SortByName(folder_info.GUID));
  ensureOrder(sortedOrder);
  yield PT.undo();
  ensureOrder(originalOrder);
  yield PT.redo();
  ensureOrder(sortedOrder);

  // Cleanup
  observer.reset();
  yield PT.undo();
  ensureOrder(originalOrder);
  yield PT.undo();
  ensureItemsRemoved(...originalOrder, folder_info);
});

add_task(function* test_livemark_txns() {
  let livemark_info =
    { feedURI: NetUtil.newURI("http://test.feed.uri")
    , parentGUID: yield PlacesUtils.promiseItemGUID(root)
    , title: "Test Livemark" };
  function ensureLivemarkAdded() {
    ensureItemsAdded({ GUID:       livemark_info.GUID
                     , title:      livemark_info.title
                     , parentGUID: livemark_info.parentGUID
                     , itemType:   bmsvc.TYPE_FOLDER });
    let annos = [{ name:  PlacesUtils.LMANNO_FEEDURI
                 , value: livemark_info.feedURI.spec }];
    if ("siteURI" in livemark_info) {
      annos.push({ name: PlacesUtils.LMANNO_SITEURI
                 , value: livemark_info.siteURI.spec });
    }
    ensureAnnotationsSet(livemark_info.GUID, annos);
  }
  function ensureLivemarkRemoved() {
    ensureItemsRemoved({ GUID:       livemark_info.GUID
                       , parentGUID: livemark_info.parentGUID });
  }

  function* _testDoUndoRedoUndo() {
    observer.reset();
    livemark_info.GUID = yield PT.transact(PT.NewLivemark(livemark_info));
    ensureLivemarkAdded();

    observer.reset();
    yield PT.undo();
    ensureLivemarkRemoved();

    observer.reset();
    yield PT.redo();
    ensureLivemarkAdded();

    yield PT.undo();
    ensureLivemarkRemoved();
  }

  yield* _testDoUndoRedoUndo()
  livemark_info.siteURI = NetUtil.newURI("http://feed.site.uri");
  yield* _testDoUndoRedoUndo();

  // Cleanup
  observer.reset();
  yield PT.clearTransactionsHistory();
});

add_task(function* test_copy() {
  let rootGUID = yield PlacesUtils.promiseItemGUID(root);

  function* duplicate_and_test(aOriginalGUID) {
    yield duplicateGUID = yield PT.transact(
      PT.Copy({ GUID: aOriginalGUID, newParentGUID: rootGUID }));
    let originalInfo = yield PlacesUtils.promiseBookmarksTree(aOriginalGUID);
    let duplicateInfo = yield PlacesUtils.promiseBookmarksTree(duplicateGUID);
    yield ensureEqualBookmarksTrees(originalInfo, duplicateInfo, false);

    function* redo() {
      yield PT.redo();
      yield ensureBookmarksTreeRestoredCorrectly(originalInfo);
      yield PT.redo();
      yield ensureBookmarksTreeRestoredCorrectly(duplicateInfo);
    }
    function* undo() {
      yield PT.undo();
      // also undo the original item addition.
      yield PT.undo();
      yield ensureNonExistent(aOriginalGUID, duplicateGUID);
    }

    yield undo();
    yield redo();
    yield undo();
    yield redo();

    // Cleanup. This also remove the original item.
    yield PT.undo();
    observer.reset();
    yield PT.clearTransactionsHistory();
  }

  // Test duplicating leafs (bookmark, separator, empty folder)
  let bmTxn = PT.NewBookmark({ uri: NetUtil.newURI("http://test.item.duplicate")
                             , parentGUID: rootGUID
                             , annos: [{ name: "Anno", value: "AnnoValue"}] });
  let sepTxn = PT.NewSeparator({ parentGUID: rootGUID, index: 1 });
  let livemarkTxn = PT.NewLivemark(
    { feedURI: NetUtil.newURI("http://test.feed.uri")
    , parentGUID: yield PlacesUtils.promiseItemGUID(root)
    , title: "Test Livemark", index: 1 });
  let emptyFolderTxn = PT.NewFolder(yield createTestFolderInfo());
  for (let txn of [livemarkTxn, sepTxn, emptyFolderTxn]) {
    let guid = yield PT.transact(txn);
    yield duplicate_and_test(guid);
  }

  // Test duplicating a folder having some contents.
  let filledFolderGUID = yield PT.transact(function *() {
    let folderGUID = yield PT.NewFolder(yield createTestFolderInfo());
    let nestedFolderGUID = yield PT.NewFolder({ parentGUID: folderGUID
                                              , title: "Nested Folder" });
    // Insert a bookmark under the nested folder.
    yield PT.NewBookmark({ uri: NetUtil.newURI("http://nested.nested.bookmark")
                         , parentGUID: nestedFolderGUID });
    // Insert a separator below the nested folder
    yield PT.NewSeparator({ parentGUID: folderGUID });
    // And another bookmark.
    yield PT.NewBookmark({ uri: NetUtil.newURI("http://nested.bookmark")
                         , parentGUID: folderGUID });
    return folderGUID;
  });

  yield duplicate_and_test(filledFolderGUID);

  // Cleanup
  yield PT.clearTransactionsHistory();
});

add_task(function* test_array_input_for_transact() {
  let rootGuid = yield PlacesUtils.promiseItemGUID(root);

  let folderTxn = PT.NewFolder(yield createTestFolderInfo());
  let folderGuid = yield PT.transact(folderTxn);

  let sep1_txn = PT.NewSeparator({ parentGUID: folderGuid });
  let sep2_txn = PT.NewSeparator({ parentGUID: folderGuid });
  yield PT.transact([sep1_txn, sep2_txn]);
  ensureUndoState([[sep2_txn, sep1_txn], [folderTxn]], 0);

  let ensureChildCount = function* (count) {
    let tree = yield PlacesUtils.promiseBookmarksTree(folderGuid);
    if (count == 0)
      Assert.ok(!("children" in tree));
    else
      Assert.equal(tree.children.length, count);
  };

  yield ensureChildCount(2);
  yield PT.undo();
  yield ensureChildCount(0);
  yield PT.redo()
  yield ensureChildCount(2);
  yield PT.undo();
  yield ensureChildCount(0);

  yield PT.undo();
  Assert.equal((yield PlacesUtils.promiseBookmarksTree(folderGuid)), null);

  // Cleanup
  yield PT.clearTransactionsHistory();
});
