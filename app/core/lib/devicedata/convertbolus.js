// == BSD2 LICENSE ==
// Copyright (c) 2014, Tidepool Project
//
// This program is free software; you can redistribute it and/or modify it under
// the terms of the associated License, which is identical to the BSD 2-Clause
// License as published by the Open Source Initiative at opensource.org.
//
// This program is distributed in the hope that it will be useful, but WITHOUT
// ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
// FOR A PARTICULAR PURPOSE. See the License for more details.
//
// You should have received a copy of the License along with this program; if
// not, you can obtain one from Tidepool Project at tidepool.org.
// == BSD2 LICENSE ==

'use strict';
/* jshint -W015 */

var _ = require('lodash');
var Rx = require('rx');

// Require it so that it gets registered
require('../rx/selfjoin.js');

/**
 * A map of "builders".  Builders factories for handlers, which know how to handle joining a specific type of event.
 *
 * A builder is a `function()`.  It returns a handler, which is an object of two methods:
 *
 * 1. `canHandle(event)` -- returns boolean if the handler can handle the message
 * 2. `handle(event)` -- "handles" the event and returns either `null` for "not done joining" or an array of events
 * that should be emitted.  Returning an array is an indication that this handler is done handling things and should
 * be thrown away.
 */
function dualNormalBuilder() {
  var eventBuffer = [];
  var normal = null;
  var square = null;
  var myDeviceId = null;
  return {
    completed: function () {
      var retVal = [];

      function addIfNotNull(e) {
        if (e != null) {
          retVal.push(_.assign({}, e, { _unmatched: true }));
        }
      }

      addIfNotNull(normal);
      addIfNotNull(square);
      return retVal.concat(eventBuffer);
    },
    handle: function (event) {
      if (event.type !== 'bolus') {
        eventBuffer.push(event);
        return null;
      }

      if (myDeviceId != null && event.deviceId !== myDeviceId) {
        eventBuffer.push(event);
        return null;
      }

      switch (event.subType) {
        case 'dual/normal':
          normal = event;
          myDeviceId = event.deviceId;
          break;
        case 'dual/square':
          square = event;
          myDeviceId = event.deviceId;
          break;
        default:
          eventBuffer.push(event);
          return null;
      }

      if (normal == null || square == null) {
        return null;
      }

      if (normal.joinKey !== square.joinKey) {
        throw new Error('Mismatched joinKeys['+normal.joinKey+']['+square.joinKey+'] at ts['+normal.deviceTime+']');
      }

      return [
        {
          id: normal.id,
          joinKey: normal.joinKey,
          deviceId: normal.deviceId,
          initialDelivery: normal.value,
          extendedDelivery: square.value,
          value: normal.value + square.value,
          deviceTime: normal.deviceTime,
          duration: square.duration,
          extended: true,
          type: 'bolus',
          source: normal.source
        }
      ].concat(eventBuffer);
    }
  };
}

if (Rx.Observable.prototype.tidepoolConvertBolus == null) {
  /**
   * A function that does a self-join on the provided eventStream (an Observable) in order to join together
   * bolus records.
   *
   * The idea is basically to intercept a bolus record and if it is of a subType that needs to be joined with
   * other records, we set it aside and start buffering up all other events while we wait for the joined event
   * to be completed.  Once completed, the joined event is emitted and all buffered events are also emitted.

   * @param eventStream an Observable to have its bolus events self-joined.
   */
  Rx.Observable.prototype.tidepoolConvertBolus = function () {
    return this.tidepoolSelfJoin(
      [
        function (e) {
          if (! (e.type === 'bolus' && e.subType === 'dual/normal')) {
            return null;
          }

          if (e._unmatched) {
            return null;
          }

          return dualNormalBuilder();
        }
      ])
      .map(function(e) {
            // Doing source-specific processing here is pretty broken, but it's the "simplest" way to
            // get it working given a lack of standard for the data type.  When we go back and
            // standardize the tidepool data format, this will probably need adjustment.
            if (e.type === 'bolus' && e.subType === 'square' && e.source === 'diasend') {
              return _.assign(
                _.omit(e, 'immediate', 'extended'),
                {
                initialDelivery: e.immediate,
                extendedDelivery: e.extended,
                extended: true,
                type: 'bolus'
                }
              );
            }
            return e;
          })
      .map(function(e){
                        if (e.time != null && e.type === 'bolus') {
                          if (e.subType === 'normal') {
                            return _.assign({}, e, {value: e.normal, recommended: e.normal});
                          } else {
                            return _.assign({}, e, {value: e.normal + e.extended, initialDelivery: e.normal, extendedDelivery: e.extended, extended: true});
                          }
                        }
                        return e;
                      });
  };
}

module.exports = function (eventStream) {
  return eventStream.tidepoolConvertBolus();
};
