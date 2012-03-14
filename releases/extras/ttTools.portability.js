ttTools.portability = {

  init : function () {
    this.views.import.render();
  },

  isSupported : function () {
    return $('<div/>').draggable ? true : false;
  },

  importProcess : {
    operations : [],
    completed  : 0,
    timeout    : null
  },

  importPlaylist : function (playlist) {
    if (playlist.length == 0) { return this.views.import.update(); }
    
    LOG("I'm using ttTools to import a playlist, but it's really slow because your api only allows adding one song at a time and has rate limiting. Can we work together to solve this? https://github.com/egeste/ttTools");
    
    if (ttTools.database.isSupported()) { turntable.playlist.addSong = turntable.playlist.addSongFunc; }
    
    this.importProcess.operations = [];
    this.importProcess.completed = 0;

    $(playlist).each(function (index, song) {
      if ($.inArray(song.fileId, Object.keys(turntable.playlist.songsByFid)) > -1) { return; }

      var operation = function (count) {
        count = (count == undefined) ? 1 : count;

        if (count > 3) {
          ttTools.portability.importOperations.splice(ttTools.portability.importProcess.completed, 1);
          ttTools.portability.views.import.update();
        }

        var deferredRetry = function () { operation(count++); }
        ttTools.portability.importProcess.timeout = setTimeout(deferredRetry, 10000);

        var apiCallback = function (response) {
          clearTimeout(ttTools.portability.importProcess.timeout);
          if (!response.success) { return operation(count++); }
          ttTools.portability.importProcess.completed++;
          ttTools.portability.views.import.update();
          turntable.playlist.files.push(song);
          turntable.playlist.songsByFid[song.fileId] = song;
          turntable.playlist.updatePlaylist();
          if (ttTools.database.isSupported() && song.tags) {
            ttTools.tags.getTagsForFid(song.fileId, function (tx, result) {
              var tags = [];
              for (var i=0; i<result.rows.length; i++) { tags.push(result.rows.item(i).tag); }
              $(song.tags).each(function (index, tag) {
                if ($.inArray(tag, tags) < 0) {
                  ttTools.tags.addTag(song.fileId, tag, function (tx, result) {
                    ttTools.tags.updateQueue();
                  });
                }
              });
            })
          }
          if (ttTools.portability.importProcess.operations[ttTools.portability.importProcess.completed]) {
            ttTools.portability.importProcess.operations[ttTools.portability.importProcess.completed]();
          }
        }
        var deferredOperation = function () { ttTools.portability.importSong(song, apiCallback); }
        setTimeout(deferredOperation, 1500); // Offset to avoid getting nailed by the rate limiting
      }
      ttTools.portability.importProcess.operations.push(operation);
    });
    if (this.importProcess.operations.length == 0) { return this.views.import.update(); }
    this.importProcess.operations[0]();
  },

  importSong : function (song, callback) {
    var messageId = turntable.messageId;
    turntable.messageId++;
    turntable.whenSocketConnected(function() {
      turntable.socket.send(JSON.stringify({
        msgid         : messageId,
        clientid      : turntable.clientId,
        userid        : turntable.user.id,
        userauth      : turntable.user.auth,
        api           : 'playlist.add',
        playlist_name : 'default',
        index         : turntable.playlist.files.length + 1,
        song_dict     : {
          fileid: song.fileId
        }
      }));
      turntable.socketKeepAlive(true);
      turntable.pendingCalls.push({
        msgid    : messageId,
        deferred : $.Deferred(),
        time     : util.now(),
        handler  : callback
      });
    });
  },

  exportSongs : function () {
    if (!ttTools.database.isSupported()) {
      return window.location.href = 'data:text/json;charset=utf-8,' + JSON.stringify(turntable.playlist.files);
    }
    ttTools.tags.getAll(function (tx, result) {
      var songsByFid = turntable.playlist.songsByFid;
      for (var i=0; i<result.rows.length; i++) {
        if (!songsByFid[result.rows.item(i).fid]) { continue; }
        if (songsByFid[result.rows.item(i).fid].tags) {
          songsByFid[result.rows.item(i).fid].tags.push(result.rows.item(i).tag)
        } else {
          songsByFid[result.rows.item(i).fid].tags = [result.rows.item(i).tag];
        }
      }
      var playlist = [];
      for (song in songsByFid) { playlist.push(songsByFid[song]); }
      return window.location.href = 'data:text/json;charset=utf-8,' + JSON.stringify(playlist);
    }, function (tx, result) {
      turntable.showAlert("Attempted to export your tags with your songs, but it failed. Sorry :/ Here's a regular export.");
      return window.location.href = 'data:text/json;charset=utf-8,' + JSON.stringify(turntable.playlist.files);
    });
  },

  exportSongsWithTags : function (tags) {
    if (tags.length < 2 && tags[0] == '') {
      return turntable.showAlert('No tags specified', ttTools.views.settings.render);
    }
    ttTools.tags.getAll(function (tx, result) {
      var tagsByFid = {},
          matchFids = [];
      for (var i=0; i<result.rows.length; i++) {
        if (tagsByFid[result.rows.item(i).fid]) {
          tagsByFid[result.rows.item(i).fid].push(result.rows.item(i).tag);
        } else {
          tagsByFid[result.rows.item(i).fid] = [result.rows.item(i).tag];
        }
        if ($.inArray(result.rows.item(i).tag, tags) > -1) {
          matchFids.push(result.rows.item(i).fid);
        }
      }
      var playlist = [];
      $(turntable.playlist.files).each(function (index, file) {
        if ($.inArray(file.fileId, matchFids) > -1) {
          file.tags = tagsByFid[file.fileId];
          playlist.push(file);
        }
      });
      if (playlist.length < 1) {
        return turntable.showAlert("You have no music tagged with " + tags.join(', '));
      }
      return window.location.href = 'data:text/json;charset=utf-8,' + JSON.stringify(playlist);
    });
  }
}
ttTools.portability.views = {

  import : {
    render : function () {
      $('<style/>', {
        type : 'text/css',
        text : "\
        .mainPane.noBG { background-color:transparent; }\
        .import {\
          top:0;\
          left:0;\
          right:0;\
          bottom:0;\
          color:#fff;\
          text-align:center;\
          padding:30px 10px;\
          position:absolute;\
          background-color:#000;\
          border:2px dashed #fff;\
          opacity:0.8;\
          filter:Alpha(Opacity=80);\
        }\
      "}).appendTo($(document.body));

      var playlist = $('#playlist');
      var dropZone = $('<div/>', {
        id      : 'importDropZone',
        'class' : 'import'
      }).html(
        'Drop ttTools playlist file here to import.'
      );
      var dropZoneContainer = $('<div/>', {
        id      : 'dropZoneContainer',
        'class' : 'mainPane noBG'
      }).append(
        dropZone
      ).hide().appendTo(playlist);
      var importProgressContainer = $('<div/>', {
        id      : 'importProgressContainer',
        'class' : 'mainPane noBG'
      }).append(
        $('<div/>', {
          id      : 'importProgress',
          'class' : 'import'
        }).html(
          "Processing..."
        ).append(
          $('<div/>', {
            id : 'importProgressBar'
          }).progressbar()
        ).append(
          '<span id="importCount">0</span> of <span id="importTotal">0</span>'
        ).append(
          '<br/><br/>Yep, it\'s super slow. Want to help make it faster? Click the ? feedback icon above your DJ queue and send the message:<br /><br/>"I <3 ttTools! Please add batch fid support for the playlist.add API method!"'
        )
      ).hide().appendTo(playlist);

      playlist.get(0).addEventListener('dragenter', function (e) {
        dropZoneContainer.show();
      });
      dropZone.get(0).addEventListener('dragleave', function (e) {
        dropZoneContainer.hide();
      });
      dropZone.get(0).addEventListener('dragover', function (e) {
        e.preventDefault();
      });
      dropZone.get(0).addEventListener('drop', function (e) {
        dropZoneContainer.hide();
        importProgressContainer.show();
        for (var i=0; i<e.dataTransfer.files.length; i++) {
          var reader = new FileReader();
          reader.onload = function () {
            ttTools.portability.importPlaylist(JSON.parse(this.result));
          }
          reader.readAsText(e.dataTransfer.files[i], 'utf-8');
        }
      });
    },

    update : function () {
      var total = ttTools.portability.importProcess.operations.length;
      var completed = ttTools.portability.importProcess.completed;
      $('#importTotal').html(total);
      $('#importCount').html(completed);
      $('#importProgressBar').progressbar('option', 'value', (completed / total) * 100);
      if (completed == total) {
        if (ttTools.database.isSupported()) {
          ttTools.tags.updateQueue();
          ttTools.tags.addSongOverride();
        }
        $('#importProgressContainer').hide();
      }
    }
  }
  
}
