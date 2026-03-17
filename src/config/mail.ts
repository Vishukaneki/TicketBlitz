// src/config/mail.ts
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

export const createRealTransporter = () => {
  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465, // SSL port for secure email
    secure: true, 
    auth: {
      user: process.env.GMAIL_USER, 
      pass: process.env.GMAIL_APP_PASSWORD, 
    },
  });
};

export const sendTicketEmail = async (to: string, bookingDetails: any) => {
  try {
    const transporter = createRealTransporter();

    const senderName = '"TicketBlitz Pro 🎟️"'; 
    const senderEmail = process.env.GMAIL_USER;

    const info = await transporter.sendMail({
      from: `${senderName} <${senderEmail}>`,
      to: to, 
      subject: `🎟️ Ticket Confirmed: ${bookingDetails.movieTitle}!`,
      text: `Your booking for ${bookingDetails.movieTitle} is confirmed! Booking ID: ${bookingDetails.bookingId}`,
      html: `
        <div style="font-family: Arial, sans-serif; border: 2px dashed #333; padding: 20px; max-width: 500px;">
          <h2 style="color: #E50914;">🎟️ Ticket Confirmed!</h2>
          <p>Hi there,</p>
          <p>Your seats are locked and booked. Get ready for the show!</p>
          <hr/>
          <p><strong>🎬 Movie:</strong> ${bookingDetails.movieTitle}</p>
          <p><strong>🆔 Booking ID:</strong> ${bookingDetails.bookingId}</p>
          <p><strong>🪑 Seats:</strong> ${bookingDetails.seats.join(', ')}</p>
          <p><strong>💰 Total Amount:</strong> ₹${bookingDetails.amount}</p>
          <hr/>
          <p style="text-align: center; color: #555;">Enjoy the experience! 🍿<br/><i>Powered by your custom backend architecture.</i></p>
        </div>
      `,
    });

    console.log(`✅ REAL Ticket Email successfully delivered to: ${to}`);
    console.log(`Message-ID: ${info.messageId}`); 
    
  } catch (error) {
    console.error(" Error sending real email:", error);
    throw error; 
  }
};