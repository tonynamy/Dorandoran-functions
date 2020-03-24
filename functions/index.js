/**
 * Copyright 2016 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
'use strict';

const functions = require('firebase-functions');


const admin = require('firebase-admin');
admin.initializeApp();

const db = admin.firestore();

/**
 * Triggers when a user gets a new follower and sends a notification.
 *
 * Followers add a flag to `/followers/{followedUid}/{followerUid}`.
 * Users save their device notification tokens to `/users/{followedUid}/notificationTokens/{notificationToken}`.
 */
exports.sendNewMessageNotification = functions.region('asia-northeast1')
    .firestore
    .document('/chatrooms/{chatroom_id}')
    .onUpdate(async (change, context) => {
    	
      const chatroom_id = context.params.chatroom_id;

      const beforeData = change.before.data();
      const afterData = change.after.data();

      //채팅방 삭제 시
      if (!afterData) {
        return console.log('Chatroom ', chatroom_id, 'deleted.');
      }

      //채팅방 유저 나갈 시
      if(!afterData.users || afterData.users.length === 0) {
        await change.after.ref.delete();
        return console.log('Remove chatroom ', chatroom_id, ' because nobody is there.');
      }

      if ( beforeData.messages.length === afterData.messages.length ) { // messages doesn't changed
        return console.log('Chatroom ', chatroom_id, ' info changed.');
      }

      console.log('We have a new message in chatroom ', chatroom_id);

      var userTokens = [];
      const userInfos = {};

      // Get Users in the Chatroom
      const getUserRefPromises = afterData.users.map(ref => 

        ref.get()

      );

      const lastMessage = afterData.messages[afterData.messages.length-1];

      const results = await Promise.all(getUserRefPromises);

      for (let i = 0; i < results.length; i++) {

        let doc = results[i];

        console.log('Got user: ', doc.id);

        userInfos[doc.id] = doc.data();

        if(doc.id !== lastMessage.uid && doc.data().fcmToken) {
          userTokens.push(doc.data().fcmToken);
        }
      }

      //remove duplicates
      userTokens = userTokens.filter((v,i) => userTokens.indexOf(v) === i);

      // Check if there are any device tokens
      if (userTokens.length === 0) {
        return console.log('There are no notification tokens to send to.');
      }

      console.log('There are', userTokens.length, 'tokens to send notifications to.');      

      var userWhoSent = "";

      if ( userInfos[ lastMessage.uid ] ) {

        userWhoSent = userInfos[ lastMessage.uid ].displayName;

      } else {

        userWhoSent = "알 수 없는 사용자";

      }

      // Notification details.
      const payload = {
        notification: {
          title: '새 메시지가 있습니다.',
          body: `${userWhoSent}: ${lastMessage.content}`,
          click_action : ".ChatActivity",
          tag: `"new_message_${chatroom_id}"`
        },
        data : {
          chatroom_id: chatroom_id, 
        },
      };

      // Send notifications to all tokens.
      const response = await admin.messaging().sendToDevice(userTokens, payload);
      // For each message check if there was an error.

      const tokensToRemove = [];

      response.results.forEach((result, index) => {
        const error = result.error;
        if (error) {
          console.error('Failure sending notification to', tokens[index], error);
          // Cleanup the tokens who are not registered anymore.
          if (error.code === 'messaging/invalid-registration-token' ||
              error.code === 'messaging/registration-token-not-registered') {
            tokensToRemove.push(tokensSnapshot.ref.child(tokens[index]).remove());
          }
        }
      });

      return Promise.all(tokensToRemove);
    });